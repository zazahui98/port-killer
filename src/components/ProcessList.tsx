import { ProcessCard } from "./ProcessCard";
import type { PortProcess } from "../types/port";

interface ProcessListProps {
  processes: PortProcess[];
  port: number;
  /** 正在被终结的 PID */
  killingPid: number | null;
  onKill: (pid: number) => void;
}

/** 占用同一端口的进程列表（通常只有 1 个，但允许并列多个） */
export function ProcessList({ processes, port, killingPid, onKill }: ProcessListProps) {
  return (
    <div className="flex flex-col gap-2.5 px-5">
      {processes.map((p) => (
        <ProcessCard
          key={`${p.pid}-${p.protocol ?? "tcp"}`}
          process={p}
          port={port}
          killing={killingPid === p.pid}
          disabled={killingPid !== null}
          onKill={onKill}
        />
      ))}
    </div>
  );
}
