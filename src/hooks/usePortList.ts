import { useCallback, useMemo, useState } from "react";

import { listPorts } from "../services/portService";
import { toPortError, isOwnerless, type PortProcess } from "../types/port";
import { isListening } from "../utils/state";

export interface PortListApi {
  /** 过滤后的行 */
  rows: PortProcess[];
  /** 扫描中 */
  loading: boolean;
  /** 扫描失败的结构化错误 */
  error: ReturnType<typeof toPortError> | null;
  /** 当前筛选关键字 */
  query: string;
  setQuery: (value: string) => void;
  /** 只看监听中的端口 */
  listeningOnly: boolean;
  setListeningOnly: (value: boolean) => void;
  /** 是否显示无主连接（TIME_WAIT 残留等） */
  showOwnerless: boolean;
  setShowOwnerless: (value: boolean) => void;
  /** 重新扫描 */
  refresh: () => void;
  /** 扫描到的总行数（过滤前） */
  total: number;
}

/**
 * 端口列表的数据与筛选。
 *
 * 过滤全部在客户端完成：一次扫描把结果拿全，切换「只看监听 / 显示无主连接」
 * 是瞬时的，不需要重新发起系统调用（全量扫描在 Windows 上要遍历四张表，
 * 在 macOS 上要起 lsof 进程，代价明显）。
 */
export function usePortList(): PortListApi {
  const [all, setAll] = useState<PortProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toPortError> | null>(null);

  const [query, setQuery] = useState("");
  // 默认只看监听：那才是「端口被占用」的答案，全量连接会把列表刷屏
  const [listeningOnly, setListeningOnly] = useState(true);
  // 默认隐藏无主连接：它们无法终结，留着只会干扰
  const [showOwnerless, setShowOwnerless] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);

    listPorts()
      .then(setAll)
      .catch((raw) => {
        setAll([]);
        setError(toPortError(raw));
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return all.filter((row) => {
      if (!showOwnerless && isOwnerless(row)) return false;
      if (listeningOnly && !isListening(row.state)) return false;

      if (!needle) return true;

      // 支持按端口 / 进程名 / PID / 地址 / 状态过滤 ——
      // 开发者找东西时脑子里可能是其中任何一个
      return (
        String(row.port).includes(needle) ||
        row.processName.toLowerCase().includes(needle) ||
        String(row.pid).includes(needle) ||
        (row.localAddress?.toLowerCase().includes(needle) ?? false) ||
        (row.state?.toLowerCase().includes(needle) ?? false) ||
        (row.executablePath?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [all, query, listeningOnly, showOwnerless]);

  return {
    rows,
    loading,
    error,
    query,
    setQuery,
    listeningOnly,
    setListeningOnly,
    showOwnerless,
    setShowOwnerless,
    refresh,
    total: all.length,
  };
}
