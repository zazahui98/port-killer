/**
 * English copy.
 *
 * Mirrors the key structure of `zh-CN.ts` — any key added there must be added
 * here too, otherwise the UI silently falls back to Chinese (or to the key
 * itself). `scripts/check-i18n.mjs` enforces that both files stay in sync.
 *
 * Plural handling: i18next picks `_one` / `_other` based on the `count`
 * variable. Languages with richer plural rules (Russian, Arabic, …) just add
 * more suffixes — the call sites do not change.
 */
export default {
  app: {
    name: "Port Killer",
    latinName: "Port Killer",
    tagline: "Free up the dev ports you're stuck on",
  },

  header: {
    settings: "Settings",
    pin: "Keep on top",
    unpin: "Stop keeping on top",
  },

  /** Window controls on the custom title bar */
  window: {
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
  },

  input: {
    label: "Port",
    placeholder: "Enter a port, e.g. 3000",
    hint: "Enter a port between {{min}} and {{max}}",
    submit: "Check",
  },

  quickPorts: {
    title: "Common",
    check: "Check port {{port}}",
  },

  status: {
    /** Port-only heading, shared by the available / occupied / failed states */
    portLabel: "Port {{port}}",
    checking: "Checking port {{port}}…",
    killing: "Killing process…",
    released: "Port {{port}} released",
    releasedDetail: "The port is free to use now",
    availableDetail: "Nothing is using this port — go ahead and start your dev server",
    occupied: "Port is in use",
    occupiedMany_one: "Found {{count}} related process",
    occupiedMany_other: "Found {{count}} related processes",
    failed: "Kill failed, the port is still in use",
    failedMany_one: "Kill failed, {{count}} process is still using this port",
    failedMany_other: "Kill failed, {{count}} processes are still using this port",
  },

  process: {
    pid: "PID",
    port: "Port",
    protocol: "Protocol",
    address: "Address",
    state: "State",
    path: "Path",
    kill: "Kill process",
    killing: "Killing…",
    killAria: "Kill process {{name}} (PID {{pid}})",
    cardAria: "Process {{name}}, PID {{pid}}",
    ownerless: "Ownerless",
    ownerlessHint:
      "This connection has no owning process (usually TIME_WAIT residue) and cannot be killed",
    hoverForFullCommand: "Hover to see the full command line",
    connections_one: "{{count}} connection",
    connections_other: "{{count}} connections",
  },

  empty: {
    title: "Nothing to free up",
    hint: "Enter a port number to see what's using it",
    focusInput: "Focus the input",
  },

  action: {
    checkOther: "Check another port",
    recheck: "Check again",
    refresh: "Refresh",
    close: "Close",
    cancel: "Cancel",
    back: "Back",
    done: "Done",
    clear: "Clear",
  },

  /**
   * Keys match Rust's `PortError::code()` one-to-one.
   * The native `message` is only a fallback for UNKNOWN — every user-facing
   * string is decided here, so adding a language never touches Rust.
   */
  error: {
    INVALID_PORT: {
      title: "Invalid port number",
      detail: "Enter a port between {{min}} and {{max}}",
    },
    PERMISSION_DENIED: {
      title: "Permission denied",
      detail: "Killing this process requires higher system privileges.",
    },
    PROCESS_NOT_FOUND: {
      title: "That process is gone",
      detail: "It probably exited on its own after the check.",
    },
    KILL_FAILED: {
      title: "Could not kill the process",
      detail:
        "Possible causes: insufficient permission, the process refused to die, or a system restriction.",
    },
    PLATFORM_UNSUPPORTED: {
      title: "Unsupported platform",
      detail: "Port Killer supports Windows, macOS and Linux.",
    },
    UNKNOWN: {
      title: "Something went wrong",
      detail: "An unexpected error occurred. Please try again.",
    },
    elevationHint:
      "Close the app and reopen it with administrator / sudo privileges, then try again.",
  },

  dialog: {
    killTitle: "Kill {{name}}?",
    killDescription:
      "This process is holding the port. Killing it releases the port immediately.",
    forceTitle: "Force kill?",
    forceDescription:
      "Force killing terminates the process immediately — it gets no chance to save data or clean up. Unsaved work may be lost.",
    forceEntry: "Force kill",
    forceLoading: "Force killing…",
  },

  settings: {
    title: "Settings",
    appearance: "Appearance",
    currentTheme: "Currently {{theme}}",
    themeAria: "Appearance theme",
    theme: {
      system: "System",
      systemHint: "Follow the system appearance",
      dark: "Dark",
      darkHint: "Always use the dark theme",
      light: "Light",
      lightHint: "Always use the light theme",
    },
    offlineNote: "Everything is stored locally and the app runs fully offline.",
    home: "Home screen",
    showQuickPorts: "Show common ports",
    showQuickPortsHint: "Off leaves just the input box",
    language: "Language",
    languageAria: "Interface language",
  },

  list: {
    title: "Port list",
    open: "Open the port list",
    filter: "Filter by port / process / PID",
    listeningOnly: "Listening only",
    listeningOnlyHint:
      'Only show ports that are listening — that is what "address already in use" means',
    showOwnerless: "Show ownerless",
    ownerlessHint: "Connections with no owning process, such as TIME_WAIT residue",
    empty: "No matching ports",
    emptyListening: "Nothing is listening right now",
    loading: "Scanning ports…",
    count_one: "{{count}} port",
    count_other: "{{count}} ports",
    filteredCount: "{{shown}} / {{total}} ports",
    connections_one: "{{count}} connection",
    connections_other: "{{count}} connections",
    jumpToPort: "Open port {{port}} in the checker",
  },

  toast: {
    portReleased: "Port {{port}} released",
    stillOccupied_one: "Port {{port}} still has {{count}} process on it",
    stillOccupied_other: "Port {{port}} still has {{count}} processes on it",
    listRefreshed: "Port list refreshed",
    notifications: "Notifications",
    closeNotification: "Dismiss notification",
  },

  time: {
    justNow: "just now",
  },
};
