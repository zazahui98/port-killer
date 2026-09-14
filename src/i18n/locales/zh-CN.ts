/**
 * 简体中文文案。
 *
 * 结构约定：
 * - 按界面区域分组（app / input / status / dialog …），不按组件文件名 ——
 *   同一个区域可能被多个组件使用，按区域分才不会出现「同一句话写两遍」。
 * - 插值统一用 `{{name}}`，与 i18next 的默认语法一致。
 * - 复数：本应用的中文文案刻意避开「1 个 / N 个」的硬编码，
 *   需要计数的位置都写成 `{{count}} 个…`，英文用 i18next 的
 *   `_one` / `_other` 后缀处理（见 en.ts）。
 */
export default {
  app: {
    name: "端口终结者",
    latinName: "Port Killer",
    tagline: "快速释放被占用的开发端口",
  },

  header: {
    settings: "设置",
    pin: "窗口置顶",
    unpin: "取消置顶",
  },

  /** 自绘标题栏上的窗口控制按钮 */
  window: {
    minimize: "最小化",
    maximize: "最大化",
    restore: "还原",
    close: "关闭",
  },

  input: {
    label: "Port",
    placeholder: "输入端口，例如 3000",
    hint: "请输入 {{min}}–{{max}} 之间的端口",
    submit: "查询",
  },

  quickPorts: {
    title: "常用",
    check: "检查端口 {{port}}",
  },

  status: {
    /** 只含端口号的标题行，被「可用 / 占用 / 终结失败」三种状态共用 */
    portLabel: "Port {{port}}",
    checking: "检查 Port {{port}}…",
    killing: "正在终结进程…",
    released: "Port {{port}} 已释放",
    releasedDetail: "端口现在可以正常使用了",
    availableDetail: "当前没有进程占用该端口，可以直接启动你的开发服务",
    occupied: "端口已被占用",
    occupiedMany: "发现 {{count}} 个相关进程",
    failed: "终结未成功，端口仍被占用",
    failedMany: "终结未成功，仍有 {{count}} 个进程占用该端口",
  },

  process: {
    pid: "PID",
    port: "Port",
    protocol: "协议",
    address: "地址",
    state: "状态",
    path: "路径",
    kill: "终结进程",
    killing: "正在终结…",
    killAria: "终结进程 {{name}}（PID {{pid}}）",
    cardAria: "进程 {{name}}，PID {{pid}}",
    ownerless: "无主连接",
    ownerlessHint: "该连接没有归属进程（通常是 TIME_WAIT 残留），无法终结",
    hoverForFullCommand: "悬停查看完整命令行",
    connections: "{{count}} 条连接",
  },

  empty: {
    title: "没有端口需要处理",
    hint: "输入一个端口号，开始检查占用情况",
    focusInput: "聚焦输入框",
  },

  action: {
    checkOther: "检查其它端口",
    recheck: "重新检查",
    refresh: "刷新",
    close: "关闭",
    cancel: "取消",
    back: "返回",
    done: "完成",
    clear: "清空",
  },

  /**
   * 结构化错误文案。
   *
   * key 与 Rust 侧 `PortError::code()` 逐字对应（INVALID_PORT … UNKNOWN）。
   * 原生层返回的 `message` 只作为 UNKNOWN 的兜底，界面文案一律由这里决定 ——
   * 这样新增语言不需要改 Rust。
   */
  error: {
    INVALID_PORT: {
      title: "端口号不合法",
      detail: "请输入 {{min}}–{{max}} 之间的端口",
    },
    PERMISSION_DENIED: {
      title: "权限不足",
      detail: "当前进程可能需要更高系统权限才能终结。",
    },
    PROCESS_NOT_FOUND: {
      title: "该进程已不存在",
      detail: "进程可能在查询之后自行退出了。",
    },
    KILL_FAILED: {
      title: "无法终结该进程",
      detail: "可能原因：权限不足 / 进程拒绝终止 / 系统限制。",
    },
    PLATFORM_UNSUPPORTED: {
      title: "当前平台不受支持",
      detail: "端口终结者目前支持 Windows、macOS 与 Linux。",
    },
    UNKNOWN: {
      title: "操作失败",
      detail: "发生未知错误，请重试。",
    },
    elevationHint: "可以关闭应用后，用管理员 / sudo 权限重新打开再试一次。",
  },

  dialog: {
    killTitle: "终结 {{name}}？",
    killDescription: "该进程正在占用端口，终结后端口会被立即释放。",
    forceTitle: "确认强制终结？",
    forceDescription:
      "强制终结会立即终止进程，进程没有机会保存数据或清理资源。未保存的工作可能丢失。",
    forceEntry: "强制终结",
    forceLoading: "正在强制终结…",
  },

  settings: {
    title: "设置",
    appearance: "外观",
    currentTheme: "当前生效：{{theme}}",
    themeAria: "外观主题",
    theme: {
      system: "跟随系统",
      systemHint: "随系统外观自动切换",
      dark: "深色",
      darkHint: "始终使用深色主题",
      light: "浅色",
      lightHint: "始终使用浅色主题",
    },
    offlineNote: "所有配置都保存在本机，应用完全离线运行。",
    language: "语言",
    languageAria: "界面语言",
    window: "窗口",
    pinHint: "让窗口始终浮在其它窗口之上",
    about: "关于",
    platform: "运行平台",
  },

  list: {
    title: "端口列表",
    open: "打开端口列表",
    filter: "过滤端口 / 进程 / PID",
    listeningOnly: "只看监听",
    listeningOnlyHint: "只显示正在监听的端口，这才是「端口被占用」的答案",
    showOwnerless: "显示无主连接",
    ownerlessHint: "TIME_WAIT 残留等没有归属进程的连接",
    empty: "没有匹配的端口",
    emptyListening: "当前没有正在监听的端口",
    loading: "正在扫描端口…",
    count: "{{count}} 个端口",
    filteredCount: "{{shown}} / {{total}} 个端口",
    connections: "{{count}} 条连接",
    jumpToPort: "在查询里打开端口 {{port}}",
  },

  toast: {
    portReleased: "Port {{port}} 已释放",
    stillOccupied: "Port {{port}} 仍有 {{count}} 个进程占用",
    listRefreshed: "端口列表已刷新",
    notifications: "通知",
    closeNotification: "关闭通知",
  },

  time: {
    justNow: "刚刚",
  },
};
