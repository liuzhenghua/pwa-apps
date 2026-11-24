import { createECDH } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { generateRequestDetails, generateVAPIDKeys, getVapidHeaders } from 'web-push';
import { matchesAlert, openAlerts, requireAlerts } from './src/alerts.ts';
import { money } from './src/format.ts';
import { fetchQuotes } from './src/quotes.ts';

const minute = 60_000;
const maxQuoteAge = 2 * minute;

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
  if (command === '--keygen') {
    const keys = generateVAPIDKeys();
    console.log('STOCK_ALERTS_PUBLIC_KEY=' + keys.publicKey);
    console.log('STOCK_ALERTS_PRIVATE_KEY=' + keys.privateKey);
    return;
  }
  if (command && !['--init', '--test'].includes(command)) throw Error('未知选项 ' + command);

  if (existsSync('.env.stock-alerts')) process.loadEnvFile('.env.stock-alerts');
  const config = {
    folder: required('STOCK_ALERTS_FOLDER'),
    credential: required('STOCK_ALERTS_GITHUB_TOKEN'),
    secret: required('STOCK_ALERTS_DATA_SECRET'),
  };
  const vapidDetails = {
    subject: required('STOCK_ALERTS_SUBJECT'),
    publicKey: required('STOCK_ALERTS_PUBLIC_KEY'),
    privateKey: required('STOCK_ALERTS_PRIVATE_KEY'),
  };
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(vapidDetails.privateKey, 'base64url'));
  if (ecdh.getPublicKey().toString('base64url') !== vapidDetails.publicKey) {
    throw Error('VAPID 公钥和私钥不匹配');
  }
  const closedDates = new Set((process.env.STOCK_ALERTS_CLOSED_DATES ?? '').split(',').map(date => date.trim()).filter(Boolean));
  for (const date of closedDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date) throw Error('休市日期格式应为 YYYY-MM-DD');
  }

  const remote = await openAlerts(config);
  function checkedState(data) {
    const state = requireAlerts(data);
    if (state.publicKey !== vapidDetails.publicKey) throw Error('本机 VAPID 公钥与 GitHub 中的配置不匹配');
    return state;
  }

  if (command === '--init') {
    await remote.update(current => current ? checkedState(current) : {
      version: 1, publicKey: vapidDetails.publicKey, alerts: [],
    });
    console.log('价格提醒 GitHub 配置已就绪');
    return;
  }

  const authorization = new Map();
  async function send(device, payload) {
    if (!validEndpoint(device.endpoint)) throw Error('推送服务地址不受支持');
    const { origin } = new URL(device.endpoint);
    let token = authorization.get(origin);
    if (!token || token.refreshAt <= Date.now()) {
      token = {
        headers: getVapidHeaders(origin, vapidDetails.subject, vapidDetails.publicKey, vapidDetails.privateKey, 'aes128gcm'),
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

  const { data } = await remote.read();
  const initial = checkedState(data);
  if (command === '--test') {
    if (!initial.device) throw Error('请先在 iPhone 主屏幕上的股票账簿启用通知');
    await send(initial.device, { title: '股票账簿', body: '价格提醒测试通知', tag: 'stock-alert-test' });
    console.log('推送服务已接受测试通知，请在接收设备上检查');
    return;
  }

  const delivered = new Map();
  async function saveDeliveries() {
    if (!delivered.size) return;
    await remote.update(current => {
      const state = checkedState(current);
      const alerts = state.alerts.map(alert => delivered.has(alert.id) && !alert.triggeredAt
        ? { ...alert, triggeredAt: delivered.get(alert.id) } : alert);
      return alerts.some((alert, index) => alert !== state.alerts[index]) ? { ...state, alerts } : state;
    });
    delivered.clear();
  }

  async function poll() {
    await saveDeliveries();
    const now = Date.now();
    const { date, session } = marketTime(now);
    if (!session || closedDates.has(date)) return;
    const state = checkedState((await remote.read()).data);
    const device = state.device;
    if (!device) return;
    const pending = state.alerts.filter(alert => !alert.triggeredAt);
    if (!pending.length) return;
    const quotes = await fetchQuotes([...new Set(pending.map(alert => alert.symbol))], AbortSignal.timeout(10_000));

    for (const alert of pending) {
      const quote = quotes.get(alert.symbol);
      if (!quote || !matchesAlert(alert, quote.price)) continue;
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
        delivered.set(alert.id, new Date().toISOString());
        console.log('已发送提醒 ' + alert.symbol + ' ' + direction);
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          await remote.update(current => {
            const latest = checkedState(current);
            return latest.device?.endpoint === device.endpoint ? { ...latest, device: undefined } : latest;
          });
          console.error('接收设备的推送订阅已失效，请在 iPhone 上重新启用通知');
          break;
        }
        console.error('提醒发送失败，将在仍满足阈值时重试' + (error.statusCode ? '（HTTP ' + error.statusCode + '）' : ''));
      }
    }
    await saveDeliveries();
  }

  console.log('股票价格提醒已启动，按北京时间每分钟检查交易时段。按 Ctrl+C 停止。');
  while (true) {
    try {
      await poll();
    } catch (error) {
      console.error(new Date().toISOString(), error.message);
    }
    await sleep(minute - Date.now() % minute);
  }
}

main().catch(error => {
  console.error(error.statusCode ? '推送服务返回 HTTP ' + error.statusCode : error.message);
  process.exitCode = 1;
});
