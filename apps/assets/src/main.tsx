import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChartNoAxesCombined,
  CreditCard,
  House,
  Landmark,
  LayoutDashboard,
  Plus,
  Settings,
  WalletCards,
} from "lucide-react";
import {
  accountTitle,
  updateMonthlyReport,
  dataModifiedAt,
  emptyData,
  latest,
  liquidAssets,
  load,
  MONTHLY_REPORT_LIMIT,
  money,
  sameData,
  save,
  today,
  totals,
  validate,
  type Account,
  type Balance,
  type Data,
  type ReportAudit,
} from "./data";
import {
  checkRepo,
  decrypt,
  download,
  encrypt,
  readCloud,
  repository,
  validateFolder,
  writeCloud,
} from "./backup";
import { hasBundledToken, unlockBundledToken } from "./token-box";
import "./style.css";
type Page = "overview" | "accounts" | "trends" | "settings";
type TrendMetric = "net" | "assets" | "debts" | "liquid";
const categoryPresets = {
  asset: ["银行存款", "股票基金", "零钱", "房产", "其他资产"],
  debt: ["房贷", "信用卡", "消费贷", "其他负债"],
} as const;
const customCategoryValue = "__custom__";
const liquidityLabels = {
  liquid: "流动资金",
  locked: "期限内不可用",
  illiquid: "非流动资产",
} as const;
const initialLiquidity = (category: string): Account["liquidity"] =>
  category === "房产" ? "illiquid" : "liquid";
const distributionCategory = (account: Account) =>
  account.category === "银行存款"
    ? account.liquidity === "locked"
      ? "银行定期"
      : "银行活期"
    : account.category;
const dateLabel = (d: string) =>
  d
    ? new Date(`${d}T12:00:00`).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      })
    : "";
const replaceCurrentBalances = (existing: Balance[], incoming: Balance[]) => {
  const replacements = new Set(incoming.map((balance) => balance.accountId));
  return [
    ...existing.filter((balance) => !replacements.has(balance.accountId)),
    ...incoming,
  ];
};
function AccountIcon({ account }: { account: Account }) {
  const type =
    account.kind === "debt"
      ? "debt"
      : account.category === "银行存款"
        ? "bank"
        : account.category === "房产"
          ? "home"
          : account.category === "股票基金"
            ? "investment"
            : "wallet";
  const Icon =
    type === "bank"
      ? Landmark
      : type === "investment"
        ? ChartNoAxesCombined
        : type === "home"
          ? House
          : type === "debt"
            ? CreditCard
            : WalletCards;
  return (
    <span className={`recent-icon icon-${type}`}>
      <Icon aria-hidden="true" strokeWidth={1.8} />
    </span>
  );
}
function App() {
  const [data, setData] = useState<Data>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [modal, setModal] = useState<
    "account" | "balance" | "audit" | "backup" | "detail" | null
  >(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [kind, setKind] = useState<"asset" | "debt">("asset"),
    [category, setCategory] = useState("银行存款"),
    [customCategory, setCustomCategory] = useState(""),
    [liquidity, setLiquidity] = useState<Account["liquidity"]>("liquid");
  const [amount, setAmount] = useState(""),
    [effective, setEffective] = useState(today()),
    [note, setNote] = useState("");
  const [reportMonth, setReportMonth] = useState(""),
    [baselineMonth, setBaselineMonth] = useState("");
  const [returnToAudit, setReturnToAudit] = useState(false);
  const [includeProperty, setIncludeProperty] = useState(false);
  const [detailAmount, setDetailAmount] = useState<string | null>(null);
  const [assetBreakdownOpen, setAssetBreakdownOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState("all");
  const [reportBreakdownOpen, setReportBreakdownOpen] = useState(false);
  const [reportAssetFilter, setReportAssetFilter] = useState("all");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("net");
  const [includeTrendProperty, setIncludeTrendProperty] = useState(false);
  useEffect(() => {
    if (modal !== "balance") setReturnToAudit(false);
  }, [modal]);
  const [token, setToken] = useState(() =>
      hasBundledToken ? "" : localStorage.getItem("assets:token") || "",
    ),
    [tokenPassphrase, setTokenPassphrase] = useState(
      () => localStorage.getItem("assets:cloud-passphrase") || "",
    ),
    [secret, setSecret] = useState(
      () => localStorage.getItem("assets:secret") || "",
    ),
    [folder, setFolder] = useState(
      () => localStorage.getItem("assets:folder") || "",
    );
  const [loadedFolder, setLoadedFolder] = useState<string | null | undefined>(
    undefined,
  );
  const [cloudSha, setCloudSha] = useState<string | null | undefined>(
      undefined,
    ),
    [cloudData, setCloudData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [syncStage, setSyncStage] = useState(""),
    [syncFailed, setSyncFailed] = useState(false);
  const [audit, setAudit] = useState<
    Record<string, "checked" | "skipped" | "change">
  >({});
  const dataRef = useRef(data);
  useEffect(() => {
    if (hasBundledToken) localStorage.removeItem("assets:token");
    load()
      .then(async (d) => {
        await save(d);
        dataRef.current = d;
        setData(d);
        setLoaded(true);
      })
      .catch((e) => {
        setMessage(String(e));
        setLoaded(true);
      });
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [modal]);
  useEffect(() => {
    if (!message || modal) return;
    const timeout = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [message, modal]);
  useEffect(() => {
    setDetailAmount(null);
  }, [modal, selected]);
  async function commit(next: Data, reportDate?: string, audit?: ReportAudit) {
    const prepared = reportDate ? updateMonthlyReport(next, reportDate, audit) : next;
    const stamped = {
      ...prepared,
      updatedAt: Math.max(Date.now(), dataModifiedAt(data) + 1),
    };
    await save(stamped);
    dataRef.current = stamped;
    setData(stamped);
  }
  async function replaceLocal(next: Data) {
    await save(next);
    dataRef.current = next;
    setData(next);
  }
  const active = data.accounts.filter((a) => !a.archived);
  const institutionGroups = Array.from(new Set(active.map((a) => a.name))).sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  );
  const liquidTotal = liquidAssets(data);
  const categoryOptions = {
    asset: Array.from(
      new Set([
        ...categoryPresets.asset,
        ...active.filter((a) => a.kind === "asset").map((a) => a.category),
      ]),
    ),
    debt: Array.from(
      new Set([
        ...categoryPresets.debt,
        ...active.filter((a) => a.kind === "debt").map((a) => a.category),
      ]),
    ),
  };
  const current = totals(data);
  const propertyTotal = active
    .filter((account) => account.kind === "asset" && account.category === "房产")
    .reduce(
      (total, account) => total + (latest(data, account.id)?.amount || 0),
      0,
    );
  const overviewAssets = current.assets - (includeProperty ? 0 : propertyTotal);
  const overviewNet = overviewAssets - current.debts;
  const assetBreakdown = Array.from(
    new Set(active.filter((a) => a.kind === "asset").map(distributionCategory)),
  )
    .map((category) => ({
      category,
      amount: active
        .filter(
          (account) =>
            account.kind === "asset" &&
            distributionCategory(account) === category,
        )
        .reduce(
          (total, account) => total + (latest(data, account.id)?.amount || 0),
          0,
        ),
    }))
    .sort((a, b) => b.amount - a.amount);
  const selectedAccount = data.accounts.find((a) => a.id === selected);
  function openAccountEdit(a: Account) {
    setEditingId(a.id);
    setName(a.name);
    setKind(a.kind);
    setCategory(a.category);
    setCustomCategory("");
    setLiquidity(a.liquidity);
    setModal("account");
  }
  function openBalance(id: string) {
    setSelected(id);
    setAmount("");
    setEffective(today());
    setNote("");
    setModal("balance");
  }
  async function addAccount() {
    if (!name.trim()) return setMessage("请输入账户名称");
    const chosenCategory =
      category === customCategoryValue ? customCategory.trim() : category;
    if (!chosenCategory) return setMessage("请选择或填写分类");
    if (editingId) {
      await commit({
        ...data,
        accounts: data.accounts.map((a) =>
          a.id === editingId
            ? {
                ...a,
                name: name.trim(),
                kind,
                category: chosenCategory,
                product: undefined,
                liquidity,
              }
            : a,
        ),
      });
      setEditingId(null);
      setModal(null);
      setMessage("账户资料已更新");
      return;
    }
    const a: Account = {
      id: crypto.randomUUID(),
      name: name.trim(),
      kind,
      category: chosenCategory,
      liquidity,
      created: today(),
    };
    await commit({ ...data, accounts: [...data.accounts, a] });
    setName("");
    setCustomCategory("");
    openBalance(a.id);
  }
  async function addBalance() {
    if (
      !selectedAccount ||
      amount === "" ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) < 0 ||
      !effective
    )
      return setMessage("请输入有效的非负余额和日期");
    const b: Balance = {
      id: crypto.randomUUID(),
      accountId: selectedAccount.id,
      amount: Number(amount),
      date: effective,
      recordedAt: Date.now(),
      note: note.trim(),
    };
    await commit({
      ...data,
      accounts: data.accounts.map((a) =>
        a.id === b.accountId && b.date < a.created
          ? { ...a, created: b.date }
          : a,
      ),
      balances: replaceCurrentBalances(data.balances, [b]),
    }, b.date);
    if (returnToAudit) {
      const changed = latest(data, b.accountId)?.amount !== b.amount;
      setAudit((previous) => ({
        ...previous,
        [b.accountId]: changed ? "change" : "checked",
      }));
      setReturnToAudit(false);
      setModal("audit");
    } else setModal(null);
    setMessage("本月余额已更新");
  }
  async function saveDetailBalance() {
    if (
      !selectedAccount ||
      detailAmount === null ||
      detailAmount === "" ||
      !Number.isFinite(Number(detailAmount)) ||
      Number(detailAmount) < 0
    ) {
      setMessage("请输入有效的非负余额");
      return;
    }
    const balance: Balance = {
      id: crypto.randomUUID(),
      accountId: selectedAccount.id,
      amount: Number(detailAmount),
      date: today(),
      recordedAt: Date.now(),
      note: "",
    };
    await commit({
      ...data,
      balances: replaceCurrentBalances(data.balances, [balance]),
    }, balance.date);
    setDetailAmount(null);
    setMessage("余额已更新");
  }
  async function archiveAccount() {
    if (
      !selectedAccount ||
      !confirm(`归档「${accountTitle(selectedAccount)}」？月度数据仍会保留。`)
    )
      return;
    await commit({
      ...data,
      accounts: data.accounts.map((a) =>
        a.id === selected ? { ...a, archived: true, archivedAt: today() } : a,
      ),
    }, today());
    setSelected(null);
    setModal(null);
  }
  async function finishAudit() {
    const checked = Object.entries(audit)
        .filter(([, v]) => v === "checked" || v === "change")
        .map(([id]) => id),
      skipped = active
        .map((a) => a.id)
        .filter((id) => audit[id] !== "checked" && audit[id] !== "change");
    const changed = Object.entries(audit)
      .filter(([, v]) => v === "change")
      .map(([id]) => id);
    await commit(data, today(), {
      checked,
      skipped,
      changed,
      auditedAt: Date.now(),
    });
    setModal(null);
    setAudit({});
    setMessage(
      `盘点已保存：核对 ${checked.length} 个，沿用或跳过 ${skipped.length} 个`,
    );
  }
  const reports = data.reports || [];
  const selectedReport =
    reports.find((r) => r.month === reportMonth) || reports.at(-1);
  const baselineReport =
    reports.find((r) => r.month === baselineMonth) ||
    reports.filter((r) => r.month < (selectedReport?.month || "")).at(-1);
  const reportPropertyValue = (report: (typeof reports)[number] | undefined) =>
    (report?.details || [])
      .filter((item) => item.kind === "asset" && item.category === "房产")
      .reduce((total, item) => total + (item.amount || 0), 0);
  const selectedReportDetails = (selectedReport?.details || []).filter(
    (item) => includeTrendProperty || item.category !== "房产",
  );
  const selectedReportAssets = selectedReport
    ? selectedReport.assets -
      (includeTrendProperty ? 0 : reportPropertyValue(selectedReport))
    : 0;
  const selectedReportNet = selectedReport
    ? selectedReport.net -
      (includeTrendProperty ? 0 : reportPropertyValue(selectedReport))
    : 0;
  const baselineReportDetails = (baselineReport?.details || []).filter(
    (item) => includeTrendProperty || item.category !== "房产",
  );
  const baselineReportNet = baselineReport
    ? baselineReport.net -
      (includeTrendProperty ? 0 : reportPropertyValue(baselineReport))
    : 0;
  const reportAssetDetails = selectedReportDetails.filter(
    (item) => item.kind === "asset",
  );
  const reportBreakdown = Array.from(
    new Set(
      reportAssetDetails.map((item) =>
        item.category === "银行存款"
          ? item.liquidity === "locked"
            ? "银行定期"
            : "银行活期"
          : item.category,
      ),
    ),
  )
    .map((category) => ({
      category,
      amount: reportAssetDetails
        .filter((item) =>
          item.category === "银行存款"
            ? (item.liquidity === "locked" ? "银行定期" : "银行活期") ===
              category
            : item.category === category,
        )
        .reduce((total, item) => total + (item.amount || 0), 0),
    }))
    .sort((a, b) => b.amount - a.amount);
  const trend = reports.slice(-12);
  const validReports = trend.filter((r) => r.missing === 0);
  const trendMetrics: Record<
    TrendMetric,
    { label: string; color: string }
  > = {
    net: { label: "净资产", color: "#496e95" },
    assets: { label: "总资产", color: "#3f8578" },
    debts: { label: "总负债", color: "#b2764b" },
    liquid: { label: "流动资金", color: "#6f72a8" },
  };
  const trendValue = (report: (typeof trend)[number]) => {
    const property = includeTrendProperty ? 0 : reportPropertyValue(report);
    if (trendMetric === "assets") return report.assets - property;
    if (trendMetric === "net") return report.net - property;
    return report[trendMetric];
  };
  const min = Math.min(...validReports.map(trendValue), 0),
    max = Math.max(...validReports.map(trendValue), 1);
  const chartMoney = (value: number) =>
    new Intl.NumberFormat("zh-CN", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const chartX = (i: number) =>
    trend.length === 1 ? 173 : 44 + (i * 258) / (trend.length - 1);
  const chartY = (value: number) => 110 - ((value - min) / (max - min)) * 85;
  async function importFile(file: File) {
    try {
      const raw = JSON.parse(await file.text());
      const imported =
        raw?.format === "assets-encrypted-v1"
          ? await decrypt(raw, secret)
          : raw;
      const checked = validate(imported);
      if (!confirm("用所选文件替换当前全部本地数据？请先导出一份备份。"))
        return;
      await commit(checked);
      setMessage("备份已导入");
      setModal(null);
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function syncGithub() {
    try {
      setBusy(true);
      setMessage("");
      setSyncFailed(false);
      setSyncStage("正在检查 GitHub 仓库…");
      setLoadedFolder(undefined);
      setCloudData(null);
      setCloudSha(undefined);
      if (!loaded) throw Error("本地数据尚未加载");
      if (!secret) throw Error("请输入数据加密口令");
      const accessToken = hasBundledToken
        ? await unlockBundledToken(tokenPassphrase)
        : token.trim();
      if (!accessToken) throw Error("请输入 GitHub Token");
      const target = validateFolder(folder);
      await checkRepo(accessToken);
      setSyncStage("正在读取云端备份…");
      const remote = await readCloud(accessToken, target);
      setSyncStage(
        remote.payload ? "正在解密并比较数据…" : "正在检查本地数据…",
      );
      const cloud = remote.payload
        ? await decrypt(remote.payload, secret)
        : emptyData();
      const local = dataRef.current;
      if (!hasBundledToken) localStorage.setItem("assets:token", accessToken);
      localStorage.setItem("assets:folder", target);
      if (!remote.payload) {
        if (dataModifiedAt(local) === 0) {
          setMessage("本地和云端都没有数据");
          return;
        }
        if (dataRef.current !== local)
          throw Error("同步期间本地数据发生变化，请重试");
        setSyncStage("正在加密并上传本地数据…");
        await writeCloud(
          accessToken,
          target,
          await encrypt(local, secret),
          null,
        );
        setMessage("本地数据较新，已加密上传到 GitHub");
        return;
      }
      if (sameData(local, cloud)) {
        setMessage("本地与云端内容相同，无需同步");
        return;
      }
      const localTime = dataModifiedAt(local),
        cloudTime = dataModifiedAt(cloud);
      if (localTime > cloudTime) {
        if (dataRef.current !== local)
          throw Error("同步期间本地数据发生变化，请重试");
        setSyncStage("正在加密并上传本地数据…");
        await writeCloud(
          accessToken,
          target,
          await encrypt(local, secret),
          remote.sha,
        );
        setMessage("本地数据较新，已加密上传到 GitHub");
        return;
      }
      if (cloudTime > localTime) {
        if (dataRef.current !== local)
          throw Error("同步期间本地数据发生变化，请重试");
        setSyncStage("正在保存云端数据到本机…");
        await replaceLocal(cloud);
        setMessage("云端数据较新，已更新本地");
        return;
      }
      throw Error(
        "两边修改时间相同但内容不同，已停止同步。请先导出本地文件，再检查数据。",
      );
    } catch (e) {
      setSyncFailed(true);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setSyncStage("");
    }
  }
  async function readLegacy() {
    try {
      setBusy(true);
      setMessage("");
      setCloudSha(undefined);
      setCloudData(null);
      setLoadedFolder(undefined);
      if (!secret) throw Error("请输入数据加密口令");
      const accessToken = hasBundledToken
        ? await unlockBundledToken(tokenPassphrase)
        : token.trim();
      if (!accessToken) throw Error("请输入 GitHub Token");
      await checkRepo(accessToken);
      const remote = await readCloud(accessToken, null);
      if (!remote.payload) throw Error("旧路径没有备份文件");
      setCloudSha(remote.sha);
      setLoadedFolder(null);
      setCloudData(await decrypt(remote.payload, secret));
      setMessage("旧路径备份已读取。可恢复到本地，然后以新名字上传。");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (
      !cloudData ||
      !confirm("用旧路径备份替换当前全部本地数据？请先导出一份本地备份。")
    )
      return;
    await commit(cloudData);
    setMessage("旧路径备份已恢复到本地；同步新名字时会上传此数据");
    setModal(null);
  }
  const distributionAccounts = active.filter(
    (a) =>
      a.kind === "asset" && (includeProperty || a.category !== "房产"),
  );
  const distributionValues = Array.from(
    new Set(distributionAccounts.map(distributionCategory)),
  )
    .map((c) => ({
      name: c,
      value: distributionAccounts
        .filter((a) => distributionCategory(a) === c)
        .reduce((n, a) => n + (latest(data, a.id)?.amount || 0), 0),
    }))
    .sort((a, b) => b.value - a.value);
  const distributionTotal = distributionValues.reduce(
    (total, category) => total + category.value,
    0,
  );
  const categories = distributionValues;
  const debtRatio =
    overviewAssets > 0 ? (current.debts / overviewAssets) * 100 : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="m16 4 12 12-12 12L4 16 16 4Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path d="m16 10 6 6-6 6-6-6 6-6Z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <div className="brand-title">
              <strong>资产簿</strong>
              {/^[\w-]{1,60}$/.test(folder.trim()) && (
                <span className="brand-user" title={folder.trim()}>
                  {folder.trim()}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          className="avatar"
          onClick={() => setPage("settings")}
          aria-label="设置"
        >
          ⚙
        </button>
      </header>
      <main>
        {!loaded ? (
          <p>正在读取本地数据…</p>
        ) : (
          <>
            {page === "overview" && (
              <>
                <div className="eyebrow">
                  资产总览 <span>{today()}</span>
                </div>
                <section className="hero">
                  <div className="hero-heading">
                    <span>当前净资产</span>
                    <div className="hero-tools">
                      <label className="property-toggle">
                        <input
                          type="checkbox"
                          checked={includeProperty}
                          onChange={(event) =>
                            setIncludeProperty(event.target.checked)
                          }
                        />
                        含房产
                      </label>
                    <button
                      className="audit-entry"
                      onClick={() => {
                        setMessage("");
                        setModal("audit");
                      }}
                      aria-label="资产盘点"
                    >
                      资产盘点
                    </button>
                    </div>
                  </div>
                  <h1>{money(overviewNet)}</h1>
                  <div className="hero-indicators">
                    <span>
                      流动资金 <b>{money(liquidTotal)}</b>
                    </span>
                    <span>
                      负债率{" "}
                      <b>
                        {debtRatio === null ? "—" : `${debtRatio.toFixed(1)}%`}
                      </b>
                    </span>
                  </div>
                  <div className="hero-rule" />
                  <div className="hero-stats">
                    <div className="total-assets">
                      总资产<strong>{money(overviewAssets)}</strong>
                    </div>
                    <div className="total-debts">
                      总负债<strong>{money(current.debts)}</strong>
                    </div>
                  </div>
                </section>
                <section className="overview-distribution">
                  <div className="section-head">
                    <h2>资产分布</h2>
                    <span>{includeProperty ? "含房产" : "不含房产"}</span>
                  </div>
                  {categories.length ? (
                    <>
                      <div
                        className="distribution-track"
                        aria-label="资产分类占比"
                      >
                        {categories.map((c, i) => (
                          <div
                            key={c.name}
                            className={`distribution-segment color-${i % 6}`}
                            style={{ flex: c.value }}
                            title={`${c.name} ${distributionTotal ? ((c.value / distributionTotal) * 100).toFixed(1) : 0}%`}
                          />
                        ))}
                      </div>
                      <div className="distribution-legend">
                        {categories.map((c, i) => (
                          <button
                            key={c.name}
                            onClick={() => setPage("accounts")}
                          >
                            <span className={`legend-dot color-${i % 6}`} />
                            <span className="legend-name">{c.name}</span>
                            <strong>
                              {distributionTotal
                                ? ((c.value / distributionTotal) * 100)
                                    .toFixed(1)
                                    .replace(/\.0$/, "")
                                : 0}
                              %
                            </strong>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="empty">录入资产余额后显示分类占比</p>
                  )}
                </section>
                <section className="overview-recent">
                  <div className="section-head">
                    <h2>最近更新</h2>
                    <button onClick={() => setPage("accounts")}>
                      查看全部 ›
                    </button>
                  </div>
                  {active
                    .map((a) => ({ account: a, balance: latest(data, a.id) }))
                    .filter((x) => x.balance)
                    .sort(
                      (a, b) => b.balance!.recordedAt - a.balance!.recordedAt,
                    )
                    .slice(0, 4)
                    .map(({ account: a, balance: b }) => (
                      <button
                        className="row"
                        key={a.id}
                        onClick={() => {
                          setSelected(a.id);
                          setPage("accounts");
                          setModal("detail");
                        }}
                      >
                        <AccountIcon account={a} />
                        <span className="row-text">
                          <strong>{accountTitle(a)}</strong>
                          <small>
                            {b!.date === today() ? "今天" : dateLabel(b!.date)}
                            更新
                          </small>
                        </span>
                        <b
                          className={
                            a.kind === "debt" ? "amount-debt" : "amount-asset"
                          }
                        >
                          {a.kind === "debt" ? "-" : ""}
                          {money(b!.amount)}
                        </b>
                      </button>
                    ))}
                  {data.balances.length === 0 && (
                    <p className="empty">余额更新会出现在这里</p>
                  )}
                </section>
                <div className="notice">
                  {active.length === 0
                    ? "先添加账户，再记录当前余额。"
                    : current.missing
                      ? `${current.missing} 个账户还没有余额记录，合计暂不完整。`
                      : `最近已知余额 · ${current.carried} 个账户沿用较早记录`}
                </div>
              </>
            )}
            {page === "accounts" && (
              <>
                <div className="page-head accounts-head">
                  <div>
                    <small>账户管理</small>
                    <h1>全部账户</h1>
                  </div>
                  <div className="action-row">
                    <button
                      className="primary small"
                      onClick={() => {
                        setEditingId(null);
                        setName("");
                        setKind("asset");
                        setCategory("银行存款");
                        setLiquidity("liquid");
                        setModal("account");
                      }}
                    >
                      <Plus aria-hidden="true" />
                      新增
                    </button>
                  </div>
                </div>
                {active.length > 0 && (
                  <div className="summary-strip">
                    <strong>{active.length}</strong>
                    <span>个账户</span>
                    <em>
                      资产 {active.filter((a) => a.kind === "asset").length} ·
                      负债 {active.filter((a) => a.kind === "debt").length}
                    </em>
                  </div>
                )}
                {active.length === 0 ? (
                  <div className="empty-state">
                    <span>▤</span>
                    <h3>还没有账户</h3>
                    <p>从银行、投资或负债账户开始。</p>
                  </div>
                ) : (
                  <>
                    {(["asset", "debt"] as const)
                      .filter((kind) => active.some((a) => a.kind === kind))
                      .map((kind) => (
                        <section key={kind}>
                          <div className="section-head">
                            <h2>
                              {kind === "asset" ? "资产账户" : "负债账户"}
                            </h2>
                            {kind === "asset" ? (
                              <button
                                className="account-total-toggle"
                                onClick={() =>
                                  setAssetBreakdownOpen((open) => !open)
                                }
                                aria-expanded={assetBreakdownOpen}
                              >
                                {money(current.assets)}
                                <span
                                  className={assetBreakdownOpen ? "expanded" : ""}
                                  aria-hidden="true"
                                />
                              </button>
                            ) : (
                              <span>{money(current.debts)}</span>
                            )}
                          </div>
                          {kind === "asset" && assetBreakdownOpen && (
                            <div className="asset-breakdown">
                              <button
                                className={assetFilter === "all" ? "active" : ""}
                                onClick={() => setAssetFilter("all")}
                              >
                                <span>全部资产</span>
                                <strong>{money(current.assets)}</strong>
                              </button>
                              {assetBreakdown.map((item) => (
                                <button
                                  key={item.category}
                                  className={
                                    assetFilter === item.category ? "active" : ""
                                  }
                                  onClick={() => setAssetFilter(item.category)}
                                >
                                  <span>{item.category}</span>
                                  <strong>{money(item.amount)}</strong>
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="card list">
                            {institutionGroups.flatMap((institution) =>
                              active
                                .filter(
                                  (a) =>
                                    a.kind === kind &&
                                    a.name === institution &&
                                    (kind !== "asset" ||
                                      assetFilter === "all" ||
                                      distributionCategory(a) === assetFilter),
                                )
                                .map((a, index) => {
                                  const b = latest(data, a.id);
                                  return (
                                    <React.Fragment key={a.id}>
                                      {index === 0 && (
                                        <div className="institution-heading">
                                          {institution}
                                        </div>
                                      )}
                                      <button
                                        className={`row ${selected === a.id ? "selected" : ""}`}
                                        key={a.id}
                                        onClick={() => {
                                          setSelected(a.id);
                                          setModal("detail");
                                        }}
                                      >
                                        <AccountIcon account={a} />
                                        <span className="row-text">
                                          <strong>{accountTitle(a)}</strong>
                                          <small>
                                            {a.category} ·{" "}
                                            {a.kind === "asset"
                                              ? `${liquidityLabels[a.liquidity]} · `
                                              : ""}
                                            {b
                                              ? `${dateLabel(b.date)} 更新`
                                              : "待录入余额"}
                                          </small>
                                        </span>
                                        <b>{b ? money(b.amount) : "—"}</b>
                                      </button>
                                    </React.Fragment>
                                  );
                                }),
                            )}
                          </div>
                        </section>
                      ))}
                  </>
                )}
              </>
            )}
            {page === "trends" && (
              <>
                <div className="page-head">
                  <div>
                    <small>按月回顾财产变化</small>
                    <h1>月度报告</h1>
                  </div>
                  <label className="trend-property-toggle report-scope-toggle">
                    <input
                      type="checkbox"
                      checked={includeTrendProperty}
                      onChange={(event) =>
                        setIncludeTrendProperty(event.target.checked)
                      }
                    />
                    含房产
                  </label>
                </div>
                {reports.length === 0 ? (
                  <p className="empty">录入第一笔余额后自动生成当月报告。</p>
                ) : (
                  <>
                    <section className="card chart-card">
                      <div className="section-head">
                        <h2>{trendMetrics[trendMetric].label}趋势</h2>
                        <span>最近 {trend.length} 个月</span>
                      </div>
                      <div className="trend-tabs" aria-label="趋势指标">
                        {(Object.keys(trendMetrics) as TrendMetric[]).map(
                          (metric) => (
                            <button
                              key={metric}
                              className={trendMetric === metric ? "active" : ""}
                              onClick={() => setTrendMetric(metric)}
                            >
                              {trendMetrics[metric].label}
                            </button>
                          ),
                        )}
                      </div>
                      <svg
                        viewBox="0 0 324 140"
                        role="img"
                        aria-label={`月度${trendMetrics[trendMetric].label}趋势`}
                      >
                        {[max, (max + min) / 2, min].map((value, index) => {
                          const y = 25 + index * 42.5;
                          return (
                            <g key={`${value}-${index}`}>
                              <line
                                x1="44"
                                y1={y}
                                x2="302"
                                y2={y}
                                stroke="#e5ebe6"
                              />
                              <text
                                x="39"
                                y={y + 3}
                                textAnchor="end"
                                fill="#8996a2"
                                fontSize="8"
                              >
                                {chartMoney(value)}
                              </text>
                            </g>
                          );
                        })}
                        {trend.map((r, i) => {
                          const prior = trend[i - 1];
                          return (
                            <g key={r.month}>
                              {i > 0 &&
                                r.missing === 0 &&
                                prior.missing === 0 && (
                                  <line
                                    x1={chartX(i - 1)}
                                    y1={chartY(trendValue(prior))}
                                    x2={chartX(i)}
                                    y2={chartY(trendValue(r))}
                                    stroke={trendMetrics[trendMetric].color}
                                    strokeWidth="2.5"
                                  />
                                )}
                              {r.missing === 0 && (
                                <g>
                                  <circle
                                    cx={chartX(i)}
                                    cy={chartY(trendValue(r))}
                                    r="10"
                                    fill="transparent"
                                  >
                                    <title>
                                      {r.month} · {trendMetrics[trendMetric].label}{" "}
                                      {money(trendValue(r))}
                                    </title>
                                  </circle>
                                  <circle
                                    cx={chartX(i)}
                                    cy={chartY(trendValue(r))}
                                    r="4"
                                    fill={trendMetrics[trendMetric].color}
                                    pointerEvents="none"
                                  />
                                  {trend.length <= 6 && (
                                    <text
                                      x={chartX(i)}
                                      y={Math.max(15, chartY(trendValue(r)) - 8)}
                                      textAnchor="middle"
                                      fill={trendMetrics[trendMetric].color}
                                      fontSize="8"
                                      fontWeight="600"
                                      pointerEvents="none"
                                    >
                                      {chartMoney(trendValue(r))}
                                    </text>
                                  )}
                                </g>
                              )}
                              <text
                                x={chartX(i)}
                                y="133"
                                textAnchor="middle"
                                fill="#8996a2"
                                fontSize="9"
                              >
                                {r.month.slice(2).replace("-", "/")}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <p className="hint">
                        过去月份按月末汇总，本月截至今天。未更新账户沿用余额；数据不完整的月份不连线。
                      </p>
                    </section>
                    <div className="section-head">
                      <h2>月度明细</h2>
                    </div>
                    <section className="card monthly-report">
                      <select
                        aria-label="报告月份"
                        value={selectedReport?.month}
                        onChange={(e) => {
                          setReportMonth(e.target.value);
                          setBaselineMonth("");
                          setReportAssetFilter("all");
                        }}
                      >
                        {[...reports].reverse().map((r) => (
                          <option key={r.month} value={r.month}>
                            {r.month.replace("-", "年")}月
                            {r.month === today().slice(0, 7) ? " · 更新中" : ""}
                          </option>
                        ))}
                      </select>
                      {selectedReport && (
                        <>
                          <div className="report-net">
                            <span>月度净资产</span>
                            <strong>{money(selectedReportNet)}</strong>
                            <small>截至 {selectedReport.asOf}</small>
                          </div>
                          <div className="report-stats">
                            <div className="report-assets-stat">
                              <span>
                                总资产
                                <button
                                  className="report-total-toggle"
                                  onClick={() =>
                                    setReportBreakdownOpen((open) => !open)
                                  }
                                  aria-label="展开资产分类汇总"
                                  aria-expanded={reportBreakdownOpen}
                                >
                                  <span
                                    className={
                                      reportBreakdownOpen ? "expanded" : ""
                                    }
                                    aria-hidden="true"
                                  />
                                </button>
                              </span>
                              <strong>{money(selectedReportAssets)}</strong>
                            </div>
                            <div>
                              总负债
                              <strong>{money(selectedReport.debts)}</strong>
                            </div>
                            <div>
                              流动资金
                              <strong>{money(selectedReport.liquid)}</strong>
                            </div>
                            <div>
                              负债率
                              <strong>
                                {selectedReportAssets > 0
                                  ? `${((selectedReport.debts / selectedReportAssets) * 100).toFixed(1)}%`
                                  : "—"}
                              </strong>
                            </div>
                          </div>
                          {reportBreakdownOpen && (
                            <div className="asset-breakdown report-breakdown">
                              <button
                                className={
                                  reportAssetFilter === "all" ? "active" : ""
                                }
                                onClick={() => setReportAssetFilter("all")}
                              >
                                <span>全部</span>
                                <strong>{money(selectedReportAssets)}</strong>
                              </button>
                              {reportBreakdown.map((item) => (
                                <button
                                  key={item.category}
                                  className={
                                    reportAssetFilter === item.category
                                      ? "active"
                                      : ""
                                  }
                                  onClick={() =>
                                    setReportAssetFilter(item.category)
                                  }
                                >
                                  <span>{item.category}</span>
                                  <strong>{money(item.amount)}</strong>
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="hint">
                            {selectedReportDetails.some(
                              (item) => item.amount === null,
                            )
                              ? `缺少 ${selectedReportDetails.filter((item) => item.amount === null).length} 个账户余额，汇总不完整。`
                              : `共 ${selectedReportDetails.length} 个账户，${selectedReportDetails.filter((item) => item.carried).length} 个沿用之前月份余额。`}
                          </p>
                          <p className="report-audit">
                            {selectedReport.auditedAt
                              ? `本月已盘点 · ${selectedReportDetails.filter((item) => item.changed).length}/${selectedReportDetails.length} 个账户金额发生变更${selectedReportDetails.some((item) => item.skipped) ? ` · ${selectedReportDetails.filter((item) => item.skipped).length} 个跳过` : ""}`
                              : "本月未盘点 · 当前为余额汇总"}
                          </p>
                          <div className="report-account-list">
                            <h3>账户明细</h3>
                            {selectedReportDetails
                              .filter((item) => {
                                if (reportAssetFilter === "all") return true;
                                if (item.kind !== "asset") return false;
                                const category =
                                  item.category === "银行存款"
                                    ? item.liquidity === "locked"
                                      ? "银行定期"
                                      : "银行活期"
                                    : item.category;
                                return category === reportAssetFilter;
                              })
                              .map((item) => (
                                <div
                                  className="report-account-row"
                                  key={item.accountId}
                                >
                                  <span>
                                    <strong>{item.name}</strong>
                                    <small>
                                      {item.category}
                                      {item.carried ? " · 沿用上月" : ""}
                                    </small>
                                  </span>
                                  <b className={item.kind === "debt" ? "debt" : ""}>
                                    {item.amount === null
                                      ? "未录入"
                                      : `${item.kind === "debt" ? "-" : ""}${money(item.amount)}`}
                                  </b>
                                </div>
                              ))}
                          </div>
                          <label className="report-compare">
                            对比月份
                            <select
                              value={baselineReport?.month || ""}
                              onChange={(e) => setBaselineMonth(e.target.value)}
                            >
                              <option value="" disabled>
                                选择已有报告
                              </option>
                              {reports
                                .filter((r) => r.month < selectedReport.month)
                                .map((r) => (
                                  <option key={r.month} value={r.month}>
                                    {r.month}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {baselineReport &&
                          baselineReport.month < selectedReport.month &&
                          !selectedReportDetails.some(
                            (item) => item.amount === null,
                          ) &&
                          !baselineReportDetails.some(
                            (item) => item.amount === null,
                          ) ? (
                            <div className="report-change">
                              较 {baselineReport.month} 净资产变化
                              <strong>
                                {selectedReportNet - baselineReportNet >= 0
                                  ? "+"
                                  : ""}
                                {money(
                                  selectedReportNet - baselineReportNet,
                                )}
                              </strong>
                              <small>
                                {baselineReportNet > 0
                                  ? `${(((selectedReportNet - baselineReportNet) / baselineReportNet) * 100).toFixed(1)}%`
                                  : "基准净资产非正数，不计算增长率"}
                              </small>
                            </div>
                          ) : (
                            <p className="hint">
                              有两个月的完整报告后可比较净资产变化。
                            </p>
                          )}
                        </>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
            {page === "settings" && (
              <>
                <div className="page-head">
                  <div>
                    <small>数据与隐私</small>
                    <h1>设置</h1>
                  </div>
                </div>
                <section className="card settings-card">
                  <h2>数据同步与备份</h2>
                  <p>
                    点击同步后自动比较本地和 GitHub
                    的修改时间，保留较新的一份。也可导出加密文件。
                  </p>
                  <button
                    className="primary"
                    onClick={() => {
                      setMessage("");
                      setCloudSha(undefined);
                      setCloudData(null);
                      setLoadedFolder(undefined);
                      setModal("backup");
                    }}
                  >
                    管理备份 →
                  </button>
                </section>
                <section className="card settings-card">
                  <h2>数据概况</h2>
                  <p>
                    {data.accounts.length} 个账户 · {data.balances.length}{" "}
                    条余额记录 · {reports.length} 份月度报告（最多保留
                    {MONTHLY_REPORT_LIMIT} 份）
                  </p>
                  <p>
                    金额统一以人民币记录。负债余额按正数输入，净资产计算时扣除。
                  </p>
                </section>
                <section className="card settings-card">
                  <h2>资产盘点</h2>
                  <p>完成盘点会更新本月报告，不单独保留盘点历史。</p>
                  <button onClick={() => setModal("audit")}>开始盘点 →</button>
                </section>
              </>
            )}
          </>
        )}
      </main>
      <nav className="bottom">
        {(
          [
            ["overview", "总览", LayoutDashboard],
            ["accounts", "账户", WalletCards],
            ["trends", "趋势", ChartNoAxesCombined],
            ["settings", "设置", Settings],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={page === id ? "active" : ""}
            onClick={() => {
              setPage(id);
              setSelected(null);
            }}
          >
            <Icon className="nav-icon" aria-hidden="true" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>
      {modal && (
        <div className="shade" onClick={() => setModal(null)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "detail" ? "账户详情" : "账户操作"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <h2>
                {
                  {
                    account: editingId ? "编辑账户" : "新增账户",
                    balance:
                      selectedAccount && latest(data, selectedAccount.id)
                        ? "更新余额"
                        : "录入首次余额",
                    audit: "资产盘点",
                    backup: "数据同步与备份",
                    detail: selectedAccount
                      ? accountTitle(selectedAccount)
                      : "账户详情",
                  }[modal]
                }
              </h2>
              <button onClick={() => setModal(null)}>×</button>
            </div>
            {modal === "detail" && selectedAccount && (
              <div className="account-detail">
                <p>
                  {selectedAccount.category} ·{" "}
                  {selectedAccount.kind === "asset"
                    ? liquidityLabels[selectedAccount.liquidity]
                    : "负债"}
                </p>
                {detailAmount === null ? (
                  <button
                    className="detail-balance-display"
                    onClick={() =>
                      setDetailAmount(
                        latest(data, selectedAccount.id)?.amount.toString() ||
                          "",
                      )
                    }
                    aria-label="编辑当前余额"
                  >
                    {latest(data, selectedAccount.id)
                      ? money(latest(data, selectedAccount.id)!.amount)
                      : "尚无余额"}
                  </button>
                ) : (
                  <label className="detail-balance-editor">
                    <span>当前余额（元）</span>
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={detailAmount}
                      onChange={(event) => setDetailAmount(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveDetailBalance();
                        if (event.key === "Escape") setDetailAmount(null);
                      }}
                    />
                  </label>
                )}
                <div className="action-row">
                  <button
                    className="primary"
                    onClick={() =>
                      detailAmount === null
                        ? openBalance(selectedAccount.id)
                        : void saveDetailBalance()
                    }
                  >
                    {detailAmount === null ? "更新余额" : "保存余额"}
                  </button>
                  <button onClick={() => openAccountEdit(selectedAccount)}>
                    编辑资料
                  </button>
                  <button onClick={archiveAccount}>归档</button>
                </div>
              </div>
            )}
            {modal === "account" && (
              <>
                <label>
                  机构或归属名称
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如 招商银行；可选择已有机构"
                    list="asset-institutions"
                  />
                  <datalist id="asset-institutions">
                    {institutionGroups.map((institution) => (
                      <option key={institution} value={institution} />
                    ))}
                  </datalist>
                </label>
                <label>
                  分类
                  <select
                    value={
                      category === customCategoryValue
                        ? customCategoryValue
                        : `${kind}:${category}`
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next =
                        raw === customCategoryValue
                          ? customCategoryValue
                          : raw.slice(raw.indexOf(":") + 1);
                      const nextKind = raw.startsWith("debt:")
                        ? "debt"
                        : raw.startsWith("asset:")
                          ? "asset"
                          : kind;
                      setCategory(next);
                      setKind(nextKind);
                      setLiquidity(initialLiquidity(next));
                      setCustomCategory("");
                    }}
                  >
                    <optgroup label="资产">
                      {categoryOptions.asset.map((c) => (
                        <option key={`asset-${c}`} value={`asset:${c}`}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="负债">
                      {categoryOptions.debt.map((c) => (
                        <option key={`debt-${c}`} value={`debt:${c}`}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                    <option value={customCategoryValue}>自定义分类…</option>
                  </select>
                </label>
                {category === customCategoryValue && (
                  <>
                    <label>
                      自定义分类名称
                      <input
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        placeholder="输入分类名称"
                      />
                    </label>
                    <label>
                      自定义分类归属
                      <select
                        value={kind}
                        onChange={(e) =>
                          setKind(e.target.value as "asset" | "debt")
                        }
                      >
                        <option value="asset">资产</option>
                        <option value="debt">负债</option>
                      </select>
                    </label>
                  </>
                )}
                {kind === "asset" && (
                  <label>
                    资金可用性
                    <select
                      value={liquidity}
                      onChange={(e) =>
                        setLiquidity(e.target.value as Account["liquidity"])
                      }
                    >
                      <option value="liquid">流动资金 · 可随时使用</option>
                      <option value="locked">期限内不可用</option>
                      <option value="illiquid">非流动资产 · 如房产</option>
                    </select>
                  </label>
                )}
                <p className="subtle">
                  同一机构可以建立多个账户。银行存款选“流动资金”视为活期，选“期限内不可用”视为定期。
                </p>
                <button className="primary full" onClick={addAccount}>
                  {editingId ? "保存账户资料" : "创建账户"}
                </button>
              </>
            )}
            {modal === "balance" && (
              <>
                {selectedAccount && !latest(data, selectedAccount.id) && (
                  <p className="subtle">
                    账户已创建，请填写首次
                    {selectedAccount.kind === "debt" ? "剩余欠款" : "余额"}。
                    {selectedAccount.category === "房贷"
                      ? "房贷请填写尚未偿还的贷款本金。"
                      : ""}
                  </p>
                )}
                <p className="subtle">
                  {selectedAccount ? accountTitle(selectedAccount) : ""} ·
                  上次余额{" "}
                  {selectedAccount && latest(data, selectedAccount.id)
                    ? money(latest(data, selectedAccount.id)!.amount)
                    : "无"}
                </p>
                <label>
                  {selectedAccount?.kind === "debt"
                    ? "剩余欠款（元）"
                    : "当前余额（元）"}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  余额对应日期
                  <input
                    type="date"
                    value={effective}
                    max={today()}
                    onChange={(e) => setEffective(e.target.value)}
                  />
                </label>
                <label>
                  备注（可选）
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="例如 月末盘点"
                  />
                </label>
                <button className="primary full" onClick={addBalance}>
                  保存余额
                </button>
              </>
            )}
            {modal === "audit" && (
              <>
                <p className="subtle">
                  集中核对各账户：余额没变选“确认无变化”，有变化点“改余额”。
                </p>
                {active.map((a) => (
                  <div className="audit-row" key={a.id}>
                    <div>
                      <strong>{accountTitle(a)}</strong>
                      <small>
                        {latest(data, a.id)
                          ? money(latest(data, a.id)!.amount)
                          : "未录入"}
                      </small>
                    </div>
                    <select
                      value={audit[a.id] || "skipped"}
                      onChange={(e) =>
                        setAudit({
                          ...audit,
                          [a.id]: e.target.value as
                            "checked" | "skipped" | "change",
                        })
                      }
                    >
                      <option value="skipped">跳过</option>
                      <option value="checked">确认无变化</option>
                      {audit[a.id] === "change" && (
                        <option value="change">已更新金额</option>
                      )}
                    </select>
                    <button
                      onClick={() => {
                        setReturnToAudit(true);
                        openBalance(a.id);
                      }}
                    >
                      改余额
                    </button>
                  </div>
                ))}
                <button className="primary full" onClick={finishAudit}>
                  完成盘点
                </button>
              </>
            )}
            {modal === "backup" && (
              <>
                <p className="subtle">
                  私有仓库：{repository} / assets/{folder.trim() || "<名字>"}
                  /portfolio.json。不同名字使用不同云端文件夹；本机数据仍是一份。
                </p>
                <label>
                  云端名字
                  <input
                    value={folder}
                    onChange={(e) => {
                      setFolder(e.target.value);
                      localStorage.setItem("assets:folder", e.target.value);
                      setCloudSha(undefined);
                      setLoadedFolder(undefined);
                      setCloudData(null);
                    }}
                    placeholder="字母、数字、下划线或连字符"
                    autoComplete="off"
                  />
                </label>
                {hasBundledToken ? (
                  <label>
                    云端访问口令
                    <input
                      type="password"
                      autoComplete="off"
                      value={tokenPassphrase}
                      onChange={(e) => {
                        setTokenPassphrase(e.target.value);
                        if (e.target.value)
                          localStorage.setItem(
                            "assets:cloud-passphrase",
                            e.target.value,
                          );
                        else localStorage.removeItem("assets:cloud-passphrase");
                      }}
                      placeholder="用于解锁 GitHub 访问凭证"
                    />
                  </label>
                ) : (
                  <label>
                    GitHub Token
                    <input
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value);
                        setCloudSha(undefined);
                        setLoadedFolder(undefined);
                        setCloudData(null);
                      }}
                      placeholder="Contents: Read and write"
                    />
                  </label>
                )}
                <label>
                  数据加密口令
                  <input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => {
                      setSecret(e.target.value);
                      if (e.target.value)
                        localStorage.setItem("assets:secret", e.target.value);
                      else localStorage.removeItem("assets:secret");
                      setCloudSha(undefined);
                      setLoadedFolder(undefined);
                      setCloudData(null);
                    }}
                    placeholder="用于加密和解密备份数据"
                  />
                </label>
                <button
                  className="clear-secret"
                  type="button"
                  onClick={() => {
                    localStorage.removeItem("assets:secret");
                    localStorage.removeItem("assets:cloud-passphrase");
                    setSecret("");
                    setTokenPassphrase("");
                    setCloudSha(undefined);
                    setLoadedFolder(undefined);
                    setCloudData(null);
                    setMessage("已清除此浏览器保存的两个口令");
                  }}
                >
                  清除已保存的口令
                </button>
                <button
                  className="primary full"
                  disabled={busy || !loaded}
                  onClick={syncGithub}
                >
                  {busy ? "同步中…" : "同步数据"}
                </button>
                {(busy || message) && (
                  <p
                    className={`sync-feedback ${busy ? "working" : syncFailed ? "error" : ""}`}
                    role="status"
                    aria-live="polite"
                  >
                    {busy ? syncStage || "正在同步…" : message}
                  </p>
                )}
                <p className="hint">
                  每次点击会自动读取云端并比较整份数据的修改时间；较新的一份会覆盖较旧的一份。同时间内容不同会停止同步。
                </p>
                <button
                  className="legacy-link"
                  disabled={busy}
                  onClick={readLegacy}
                >
                  读取旧版固定路径备份
                </button>
                {loadedFolder === null && cloudData && (
                  <button
                    className="outline full"
                    disabled={busy}
                    onClick={restore}
                  >
                    恢复旧版备份到本地
                  </button>
                )}
                <div className="divider" />
                <button
                  className="outline full"
                  onClick={async () => {
                    try {
                      download(
                        `assets-${today()}.encrypted.json`,
                        await encrypt(data, secret),
                      );
                      setMessage("加密文件已导出");
                    } catch (e) {
                      setMessage(String(e));
                    }
                  }}
                >
                  导出加密文件
                </button>
                <label className="file-label">
                  导入备份文件
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importFile(f);
                    }}
                  />
                </label>
                <p className="hint">
                  {hasBundledToken
                    ? "GitHub Token 以密文打包；云端访问口令保存在此浏览器。"
                    : "GitHub Token 保存在此浏览器中。"}
                  数据加密口令保存在此浏览器；请勿在共用设备上使用。备份口令丢失后无法解密数据。
                </p>
              </>
            )}
            {message && modal !== "backup" && (
              <p className="toast-inline">{message}</p>
            )}
          </section>
        </div>
      )}
      {message && !modal && (
        <button className="toast" onClick={() => setMessage("")}>
          {message} ×
        </button>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
