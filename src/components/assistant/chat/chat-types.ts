export type PrimitiveCell = string | number | boolean | null;

export type PythonAnalysisReadyPayload = {
  status: "requires_python_execution";
  dataPayload: Array<Record<string, PrimitiveCell>>;
  pythonCode: string;
  message?: string;
};

export type PythonWorkerState =
  { status: "idle" }
  | { status: "running"; progress: string }
  | { status: "done"; imageDataUrl: string | null; stdout: string; stderr: string; runtimeMs: number; rowCount: number }
  | { status: "error"; error: string };

export type HitlPending = {
  toolName: string;
  toolCallId: string;
  message: string;
  pendingChanges: Record<string, unknown> | null;
  __token?: string;
};
