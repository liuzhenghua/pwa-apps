import { createECDH } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { generateRequestDetails, generateVAPIDKeys, getVapidHeaders } from 'web-push';
import { applySharedAlertResults, matchesAlert, openAlerts, requireAlerts, sharedAlertTargets } from './src/alerts.ts';
import { decrypt, encrypt } from './src/backup.ts';
import { money } from './src/format.ts';
import { fetchQuotes } from './src/quotes.ts';

const minute = 60_000;
const maxQuoteAge = 2 * minute;
const ruleRefreshInterval = 30 * minute;

function required(key) {
  if (!process.env[key]?.trim()) throw Error('请配置 ' + key);
  return process.env[key];
}


function marketTime(time) {
  const china = new Date(time + 8 * 60 * minute);
  const day = china.getUTCDay();
  const date = china.toISOString().slice(0, 10);
  const hhmm = china.getUTCHours() * 100 + china.getUTCMinutes();
  const session = hhmm >= 930 && hhmm <= 1130 ? 'AM' : hhmm >= 1300 && hhmm <= 1500 ? 'PM' : undefined;
  return { date, session: day >= 1 && day <= 5 ? session : undefined };
}

function validEndpoint(endpoint) {
  const url = new URL(endpoint);
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    (url.hostname.endsWith('.push.apple.com') || url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com');
}

async function main() {
  const command = process.argv[2];
  if (command && !['--init', '--test'].includes(command)) throw Error('未知选项 ' + command);

  const configFile = new URL('./.env.stock-alerts', import.meta.url);
  if (existsSync(configFile)) process.loadEnvFile(configFile);
  const credential = required('STOCK_ALERTS_GITHUB_TOKEN').trim();
  const secret = required('STOCK_ALERTS_KEY_SECRET');
  const subject = required('STOCK_ALERTS_SUBJECT');
  const closedDates = new Set((process.env.STOCK_ALERTS_CLOSED_DATES ?? '').split(',').map(date => date.trim()).filter(Boolean));
  for (const date of closedDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date) throw Error('休市日期格式应为 YYYY-MM-DD');
  }

  const remote = await openAlerts(credential);
  let { data } = await remote.read();
  if (command === '--init' && !data) {
    const { publicKey, privateKey } = generateVAPIDKeys();
    const privateKeyBox = await encrypt(privateKey, secret);
    data = await remote.update(current => current ?? { version: 2, publicKey, privateKeyBox, devices: {} });
  }
  const initial = requireAlerts(data);
  const { publicKey } = initial;
  let privateKey;
  try {
    privateKey = await decrypt(initial.privateKeyBox, secret);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== publicKey) throw Error('密钥不匹配');
  } catch {
    throw Error('无法解锁 GitHub 中的推送私钥，请检查 STOCK_ALERTS_KEY_SECRET 和家庭提醒配置');
  }
  if (command === '--init') {
    await remote.update(requireAlerts);
    console.log('价格提醒已初始化，推送密钥保存在 GitHub');
    return;
  }

  const authorization = new Map();
  async function send(device, payload) {
    if (!validEndpoint(device.endpoint)) throw Error('推送服务地址不受支持');
    const { origin } = new URL(device.endpoint);
    let token = authorization.get(origin);
    if (!token || token.refreshAt <= Date.now()) {
      token = {
        headers: getVapidHeaders(origin, subject, publicKey, privateKey, 'aes128gcm'),
        refreshAt: Date.now() + 60 * minute,
      };
      authorization.set(origin, token);
    }
    const request = generateRequestDetails(device, JSON.stringify(payload), { TTL: 120, urgency: 'high' });
    const response = await fetch(request.endpoint, {
      method: 'POST', headers: { ...request.headers, ...token.headers }, body: request.body,
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw Object.assign(Error('推送服务返回 HTTP ' + response.status), { statusCode: response.status });
    }
  }

  if (command === '--test') {
    const legacyDevices = Object.values(initial.devices).flatMap(device => device.subscription ? [device.subscription] : []);
    const sharedDevices = Object.values(initial.accounts ?? {}).flatMap(account => Object.values(account.devices));
    const devices = [...new Map([...legacyDevices, ...sharedDevices].map(device => [device.endpoint, device])).values()];
    if (!devices.length) throw Error('请先在 iPhone 主屏幕上的股票账簿启用通知');
    let accepted = 0;
    for (const device of devices) {
      try {
        await send(device, { title: '股票账簿', body: '价格提醒测试通知', tag: 'stock-alert-test' });
        accepted++;
      } catch (error) {
        console.error(error.statusCode ? '推送服务返回 HTTP ' + error.statusCode : '一台设备的测试通知发送失败');
      }
    }
    console.log('推送服务已接受 ' + accepted + '/' + devices.length + ' 台设备的测试通知');
    if (accepted !== devices.length) process.exitCode = 1;
    return;
  }

  function checkedState(current) {
    const state = requireAlerts(current);
    if (state.publicKey !== publicKey) throw Error('家庭推送密钥已更新，请重启盯盘程序');
    return state;
  }

  let cachedRules = initial;
  let rulesReadAt = Date.now();
  const delivered = new Map();
  const expired = new Map();
  const sharedDelivered = new Map();
  const sharedExpired = new Map();
  const hasResults = () => delivered.size || expired.size || sharedDelivered.size || sharedExpired.size;
  async function saveResults() {
    if (!hasResults()) return;
    const accounts = [...new Set([...sharedDelivered.keys(), ...sharedExpired.keys()].map(key => JSON.parse(key)[0]))];
    const updated = await remote.update(current => {
      const state = checkedState(current);
      let changed = false;
      const devices = Object.fromEntries(Object.entries(state.devices).map(([id, device]) => {
        const alerts = device.alerts.map(alert => delivered.has(alert.id) && !alert.triggeredAt
          ? { ...alert, triggeredAt: delivered.get(alert.id) } : alert);
        const stale = expired.has(id) && expired.get(id) === device.subscription?.endpoint;
        if (!stale && !alerts.some((alert, index) => alert !== device.alerts[index])) return [id, device];
        changed = true;
        return [id, { ...device, alerts, subscription: stale ? undefined : device.subscription }];
      }));
      return applySharedAlertResults(changed ? { ...state, devices } : state, sharedDelivered, sharedExpired);
    }, accounts);
    const cachedAccounts = { ...cachedRules.accounts };
    for (const name of accounts) delete cachedAccounts[name];
    cachedRules = { ...updated, accounts: { ...cachedAccounts, ...updated.accounts } };
    delivered.clear();
    expired.clear();
    sharedDelivered.clear();
    sharedExpired.clear();
  }

  async function poll() {
    const now = Date.now();
    const { date, session } = marketTime(now);
    const trading = session && !closedDates.has(date);
    if (!trading && !hasResults()) return;
    await saveResults();
    if (!trading) return;
    if (now - rulesReadAt >= ruleRefreshInterval) {
      cachedRules = checkedState((await remote.read()).data);
      rulesReadAt = Date.now();
    }
    const state = cachedRules;
    const legacy = Object.entries(state.devices).flatMap(([id, device]) => device.subscription
      ? device.alerts.filter(alert => !alert.triggeredAt).map(alert => ({ id, alert, device: device.subscription }))
      : []);
    const pending = [...legacy, ...sharedAlertTargets(state)];
    if (!pending.length) return;
    const quotes = await fetchQuotes([...new Set(pending.map(({ alert }) => alert.symbol))], AbortSignal.timeout(10_000));

    for (const { account, id, alert, device } of pending) {
      const deviceKey = account === undefined ? id : JSON.stringify([account, id]);
      const quote = quotes.get(alert.symbol);
      if ((account === undefined ? expired : sharedExpired).has(deviceKey) || !quote || !matchesAlert(alert, quote.price)) continue;
      const time = Date.parse(quote.time);
      const quoted = marketTime(time);
      if (quoted.date !== date || quoted.session !== session || now - time > maxQuoteAge || time > Date.now() + 15_000) continue;
      try {
        const direction = alert.kind === 'buy' ? '买入' : '卖出';
        const condition = alert.kind === 'buy' ? '≤' : '≥';
        await send(device, {
          title: quote.name + ' · ' + direction + '价格提醒',
          body: '最新价 ' + money(quote.price) + '，' + condition + ' 提醒价 ' + money(alert.price),
          tag: 'stock-alert-' + alert.id,
        });
        const acceptedAt = new Date().toISOString();
        if (account === undefined) delivered.set(alert.id, acceptedAt);
        else sharedDelivered.set(JSON.stringify([account, alert.id, id]), acceptedAt);
        console.log('已发送提醒 ' + alert.symbol + ' ' + direction);
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          (account === undefined ? expired : sharedExpired).set(deviceKey, device.endpoint);
          console.error('一台设备的订阅已失效，请在对应 iPhone 上重新启用通知');
        } else {
          console.error('提醒发送失败，将在仍满足阈值时重试' + (error.statusCode ? '（HTTP ' + error.statusCode + '）' : ''));
        }
      }
    }
    await saveResults();
  }

  console.log('家庭股票提醒已启动，每分钟检查行情，每 30 分钟刷新提醒规则。按 Ctrl+C 停止。');
  while (true) {
    try {
      await poll();
    } catch (error) {
      console.error(new Date().toISOString(), error.message);
    }
    await sleep(minute - Date.now() % minute);
  }
}

await main().catch(error => {
  console.error(error.statusCode ? '推送服务返回 HTTP ' + error.statusCode : error.message);
  process.exitCode = 1;
});
