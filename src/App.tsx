import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleSlash, ShieldAlert, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TitleBar } from "./components/TitleBar";
import { PortInput } from "./components/PortInput";
import { QuickPorts } from "./components/QuickPorts";
import { PortStatus } from "./components/PortStatus";
import { ProcessList } from "./components/ProcessList";
import { PortListDrawer } from "./components/PortListDrawer";
import { KillDialog } from "./components/KillDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { Button } from "./components/ui/Button";
import { useToast } from "./components/ui/toastContext";

import { useWindowChrome } from "./hooks/useWindowChrome";
import { usePortSearch } from "./hooks/usePortSearch";
import { usePortList } from "./hooks/usePortList";
import { useAlwaysOnTop } from "./hooks/useAlwaysOnTop";
import { useQuickPorts } from "./hooks/useQuickPorts";
import { useTheme } from "./hooks/useTheme";
import { getPlatform } from "./services/portService";
import { parsePortInput, PORT_MAX, PORT_MIN } from "./utils/port";
import { isMacOS } from "./utils/platform";
import { presentError, type PortError, type PortProcess } from "./types/port";

export function App() {
  const { t } = useTranslation();
  const toast = useToast();
  const { mode, isDark, setMode } = useTheme();
  const { enabled: alwaysOnTop, toggle: toggleAlwaysOnTop } = useAlwaysOnTop();
  const { enabled: showQuickPorts, toggle: toggleQuickPorts } = useQuickPorts();
  const chrome = useWindowChrome();
  const { state, setInput, submit, check, kill, reset } = usePortSearch();
  const portList = usePortList();

  const inputRef = useRef<HTMLInputElement>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** 正在等待确认/执行的终结目标 */
  const [pendingKill, setPendingKill] = useState<PortProcess | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  /** 上一次终结失败的原因（非空时弹窗内提供「强制终结」入口） */
  const [killError, setKillError] = useState<PortError | null>(null);
  const [platform, setPlatform] = useState("unknown");

  /* ---------------- 平台信息（设置面板展示） ---------------- */
  useEffect(() => {
    getPlatform()
      .then(setPlatform)
      .catch(() => setPlatform("unknown"));
  }, []);

  /* ---------------- 输入校验 ---------------- */
  const parsed = useMemo(() => parsePortInput(state.input), [state.input]);
  const inputError = parsed.invalid
    ? t("input.hint", { min: PORT_MIN, max: PORT_MAX })
    : "";

  /* ---------------- 终结流程 ---------------- */

  // 点击卡片上的「终结进程」→ 先弹确认，不直接执行
  const requestKill = useCallback(
    (pid: number) => {
      // 终结入口有两个（进程卡片、端口列表抽屉），统一在这里查找目标
      const target =
        state.processes.find((p) => p.pid === pid) ??
        portList.rows.find((p) => p.pid === pid) ??
        null;
      if (!target) return;
      setKillError(null);
      setPendingKill(target);
    },
    [state.processes, portList.rows],
  );

  /**
   * 执行终结并把结果直接翻译成界面反馈。
   *
   * 刻意写成线性流程而不是「监听状态机变化」的 effect：
   * 终结是一次有明确结果的操作，就地处理它的返回值最直观，
   * 也避免 effect 与状态机之间产生隐式的时序耦合。
   */
  const confirmKill = useCallback(
    async (force: boolean) => {
      if (!pendingKill) return;

      setKillBusy(true);
      setKillError(null);

      const outcome = await kill(pendingKill.pid, force);

      setKillBusy(false);

      switch (outcome.kind) {
        case "released":
          toast.success(t("toast.portReleased", { port: outcome.port }));
          setPendingKill(null);
          break;

        case "partial":
          toast.info(
            t("toast.stillOccupied", {
              port: outcome.port,
              count: outcome.remaining,
            }),
          );
          setPendingKill(null);
          break;

        case "failed":
          // 弹窗保持打开，由 failure 引导用户走强制终结
          setKillError(outcome.error);
          toast.error(t(presentError(outcome.error).titleKey));
          break;
      }

      // 列表视图也开着的话顺手刷新，避免继续显示已经死掉的进程
      if (listOpen) portList.refresh();
    },
    [pendingKill, kill, toast, t, listOpen, portList],
  );

  const closeKillDialog = useCallback(() => {
    setPendingKill(null);
    setKillError(null);
  }, []);

  /* ---------------- 键盘 ---------------- */

  // Cmd/Ctrl + K 聚焦输入框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- 派生 UI 状态 ---------------- */
  const busy = state.phase === "CHECKING" || state.phase === "KILLING";

  /**
   * 查询本身失败 —— 枚举端口时就出错了，此时手上没有任何进程信息，
   * 只能整块替换成错误面板。
   *
   * 判别依据刻意用「进程列表是否为空」而不是 killError：
   * KILL_FAILED 会保留上一次查到的进程列表，CHECK_FAILED 会清空它。
   * killError 只是弹窗内部的临时状态（用户取消弹窗后就会被清掉），
   * 拿它当判别条件会让同一次失败在弹窗开关之间呈现两种完全不同的界面，
   * 而两种都会丢掉「端口仍被占用」这个事实和对应的进程列表。
   */
  const queryError =
    state.phase === "FAILED" && state.processes.length === 0 && state.error
      ? presentError(state.error)
      : null;

  // 只要已经查过某个端口，结果区就应该存在
  const hasResult =
    (state.port !== null && state.phase !== "IDLE") || queryError !== null;

  /**
   * 进程列表的展示条件。
   *
   * KILLING 也要保留列表：卡片上的按钮正好用 killingPid 显示 loading，
   * 整块列表突然消失反而让用户以为操作已经完成。
   * FAILED（终结失败）同理 —— 端口还占着，列表必须留着。
   */
  const showProcesses =
    state.port !== null &&
    state.processes.length > 0 &&
    (state.phase === "OCCUPIED" ||
      state.phase === "KILLING" ||
      state.phase === "FAILED");

  // 终结失败的原因。任何错误码都要给出说明，是否提供强制入口由
  // presentError 里的 suggestForce 决定，不在组件里重复判断错误码。
  const killFailure = killError ? presentError(killError) : null;

  const handlePick = useCallback(
    (port: number) => {
      setInput(String(port));
      check(port);
    },
    [setInput, check],
  );

  // 从端口列表跳进单端口查询：先关抽屉，把结果摆到用户面前
  const handlePickFromList = useCallback(
    (port: number) => {
      setListOpen(false);
      handlePick(port);
    },
    [handlePick],
  );

  const handleReset = useCallback(() => {
    reset();
    setInput("");
    inputRef.current?.focus();
  }, [reset, setInput]);

  // 终结失败后就地重查：进程有可能在这期间自行退出了
  const handleRecheck = useCallback(() => {
    if (state.port !== null) check(state.port);
  }, [state.port, check]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      <TitleBar
        chrome={chrome}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenList={() => setListOpen(true)}
        listActive={listOpen}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
      />

      {/* 可滚动主区域 */}
      <main className="min-h-0 flex-1 overflow-y-auto pb-5">
        {/*
          内容列居中并限宽。
          窗口已放开最大尺寸（为了「最大化」名副其实），因此在宽窗口下
          必须把内容收成一条可读的列，否则输入框和卡片会横跨整个屏幕。
        */}
        <div className="mx-auto w-full max-w-[560px]">
          <PortInput
            ref={inputRef}
            value={state.input}
            onChange={setInput}
            onSubmit={submit}
            onClear={handleReset}
            error={inputError}
            loading={state.phase === "CHECKING"}
          />

          {/*
            常用端口可以整块关掉：这个工具的核心其实只有「输入端口」这一件事，
            有人只想留输入框。关掉后省下的竖向空间留给结果区。
          */}
          {showQuickPorts && (
            <div className="mt-1">
              <QuickPorts activePort={state.port} onPick={handlePick} disabled={busy} />
            </div>
          )}

          {/* 结果区 */}
          {hasResult || queryError ? (
            <div className="mt-5">
              <div className="mx-5 mb-4 h-px bg-line" />

              {queryError ? (
                <ErrorPanel
                  titleKey={queryError.titleKey}
                  detailKey={queryError.detailKey}
                  detailFallback={queryError.detailFallback}
                  suggestElevation={queryError.suggestElevation}
                  onRetry={submit}
                />
              ) : (
                <div className="flex flex-col gap-3.5">
                  {state.port !== null && (
                    <PortStatus
                      port={state.port}
                      phase={state.phase}
                      processCount={state.processes.length}
                    />
                  )}

                  {showProcesses && state.port !== null && (
                    <ProcessList
                      processes={state.processes}
                      port={state.port}
                      killingPid={state.killingPid}
                      onKill={requestKill}
                    />
                  )}

                  {(state.phase === "RELEASED" || state.phase === "AVAILABLE") && (
                    <div className="px-5">
                      <Button variant="ghost" size="sm" onClick={handleReset}>
                        {t("action.checkOther")}
                      </Button>
                    </div>
                  )}

                  {/* 终结失败：进程可能已经自行退出，给一个就地重查的入口 */}
                  {state.phase === "FAILED" && showProcesses && (
                    <div className="px-5">
                      <Button variant="ghost" size="sm" onClick={handleRecheck}>
                        {t("action.recheck")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </main>

      {/*
        key 绑定到目标 PID：换一个进程（或关闭后重开）就重新挂载，
        内部「强制终结二次确认」的步骤状态随之自然重置，
        不需要用 effect 去同步。
      */}
      <KillDialog
        key={pendingKill ? `${pendingKill.pid}` : "idle"}
        open={pendingKill !== null}
        process={pendingKill}
        port={state.port ?? 0}
        failure={killFailure}
        busy={killBusy}
        onCancel={closeKillDialog}
        onConfirm={() => void confirmKill(false)}
        onForce={() => void confirmKill(true)}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={mode}
        isDark={isDark}
        onThemeChange={setMode}
        showQuickPorts={showQuickPorts}
        onToggleQuickPorts={toggleQuickPorts}
        platform={platform}
      />

      <PortListDrawer
        open={listOpen}
        onClose={() => setListOpen(false)}
        list={portList}
        onPickPort={handlePickFromList}
        onKill={requestKill}
        killingPid={state.killingPid}
        onStartDrag={chrome.startDrag}
        onToggleMaximize={chrome.toggleMaximizeOnDoubleClick}
      />
    </div>
  );
}

/* ------------------------------------------------------------------
   空状态
   ------------------------------------------------------------------ */
function EmptyState() {
  const { t } = useTranslation();

  // 表针式扫动：悬停时图标像钟表指针一样持续旋转，
  // 移开后停在当前角度、不复位（角度只增不减）。
  const [sweep, setSweep] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  const startSweep = useCallback(() => {
    if (rafRef.current !== null) return; // 已在旋转中
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = now - lastRef.current;
      lastRef.current = now;
      // 约 120°/秒，接近秒针的扫动速度
      setSweep((prev) => (prev + dt * 0.12) % 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopSweep = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 卸载时停掉动画，避免泄漏
  useEffect(() => stopSweep, [stopSweep]);

  return (
    <div className="animate-fade-in flex flex-col items-center px-8 pt-10 pb-4 text-center">
      <span
        className="mb-3 flex size-11 items-center justify-center rounded-[14px] border border-line bg-surface"
        onMouseEnter={startSweep}
        onMouseLeave={stopSweep}
        aria-hidden
      >
        <CircleSlash
          size={18}
          className="text-fg-subtle"
          style={{ transform: `rotate(${sweep}deg)` }}
        />
      </span>
      <p className="text-[13.5px] font-medium text-fg-muted">{t("empty.title")}</p>
      <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-fg-subtle">
        {t("empty.hint")}
      </p>

      <div className="mt-6 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <kbd className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono">
          {isMacOS() ? "⌘K" : "Ctrl K"}
        </kbd>
        <span>{t("empty.focusInput")}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   错误状态
   ------------------------------------------------------------------ */
function ErrorPanel({
  titleKey,
  detailKey,
  detailFallback,
  suggestElevation,
  onRetry,
}: {
  titleKey: string;
  detailKey?: string;
  detailFallback?: string;
  suggestElevation: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="animate-fade-up px-5" role="alert">
      <div className="rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft p-3.5">
        <div className="flex items-start gap-2.5">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-fg">{t(titleKey)}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
              {detailKey
                ? t(detailKey, { min: PORT_MIN, max: PORT_MAX })
                : detailFallback}
            </p>

            {suggestElevation && (
              <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-fg-subtle">
                <Terminal size={11} className="mt-0.5 shrink-0" aria-hidden />
                <span>{t("error.elevationHint")}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t("action.recheck")}
        </Button>
      </div>
    </div>
  );
}
