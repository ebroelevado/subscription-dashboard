import { z } from "zod";

export const pythonAnalysisTemplateIds = [
  "revenue_trend",
  "discipline_distribution",
  "platform_revenue_breakdown",
] as const;

export const pythonAnalysisTemplateSchema = z.enum(pythonAnalysisTemplateIds);

const primitiveCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const dataRowSchema = z.record(z.string(), primitiveCellSchema);
const dataPayloadSchema = z.array(dataRowSchema).min(1).max(2000);

export const preparePythonAnalysisInputSchema = z.object({
  templateId: pythonAnalysisTemplateSchema,
  dataPayload: dataPayloadSchema,
  title: z.string().trim().max(120).optional(),
});

export type PythonAnalysisTemplateId = z.infer<typeof pythonAnalysisTemplateSchema>;
export type PreparePythonAnalysisInput = z.infer<typeof preparePythonAnalysisInputSchema>;

function templateCode(templateId: PythonAnalysisTemplateId): string {
  switch (templateId) {
    case "revenue_trend":
      return [
        "import pandas as pd",
        "import matplotlib.pyplot as plt",
        "",
        "df = pd.DataFrame(data_payload)",
        "if 'date' in df.columns:",
        "    df['date'] = pd.to_datetime(df['date'], errors='coerce')",
        "    df = df.sort_values('date')",
        "x_col = 'date' if 'date' in df.columns else df.columns[0]",
        "y_col = 'revenue' if 'revenue' in df.columns else ('amount' if 'amount' in df.columns else df.select_dtypes(include=['number']).columns[0])",
        "",
        "fig, ax = plt.subplots(figsize=(10, 4))",
        "ax.plot(df[x_col], df[y_col], marker='o', linewidth=2)",
        "ax.set_title(title or 'Revenue Trend')",
        "ax.set_xlabel(x_col)",
        "ax.set_ylabel(y_col)",
        "ax.grid(alpha=0.25)",
        "plt.tight_layout()",
      ].join("\n");
    case "discipline_distribution":
      return [
        "import pandas as pd",
        "import matplotlib.pyplot as plt",
        "",
        "df = pd.DataFrame(data_payload)",
        "score_col = 'disciplineScore' if 'disciplineScore' in df.columns else ('score' if 'score' in df.columns else df.select_dtypes(include=['number']).columns[0])",
        "series = pd.to_numeric(df[score_col], errors='coerce').dropna()",
        "",
        "fig, ax = plt.subplots(figsize=(8, 4))",
        "ax.hist(series, bins=10, edgecolor='white')",
        "ax.set_title(title or 'Discipline Score Distribution')",
        "ax.set_xlabel(score_col)",
        "ax.set_ylabel('Count')",
        "ax.grid(axis='y', alpha=0.2)",
        "plt.tight_layout()",
      ].join("\n");
    case "platform_revenue_breakdown":
      return [
        "import pandas as pd",
        "import matplotlib.pyplot as plt",
        "",
        "df = pd.DataFrame(data_payload)",
        "label_col = 'platform' if 'platform' in df.columns else df.columns[0]",
        "value_col = 'revenue' if 'revenue' in df.columns else ('amount' if 'amount' in df.columns else df.select_dtypes(include=['number']).columns[0])",
        "grouped = df.groupby(label_col, dropna=False)[value_col].sum().sort_values(ascending=False)",
        "",
        "fig, ax = plt.subplots(figsize=(8, 5))",
        "grouped.plot(kind='bar', ax=ax)",
        "ax.set_title(title or 'Platform Revenue Breakdown')",
        "ax.set_xlabel(label_col)",
        "ax.set_ylabel(value_col)",
        "ax.grid(axis='y', alpha=0.2)",
        "plt.tight_layout()",
      ].join("\n");
    default:
      return "";
  }
}

export function preparePythonAnalysis(input: unknown) {
  const parsed = preparePythonAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "INVALID_ANALYSIS_INPUT",
        issues: parsed.error.flatten(),
      },
    };
  }

  const { templateId, dataPayload, title } = parsed.data;

  return {
    ok: true as const,
    value: {
      status: "python_analysis_ready",
      analysisTemplateId: templateId,
      title: title ?? null,
      dataPayload,
      pythonCode: templateCode(templateId),
      safeMode: true,
      message:
        "Python analysis is ready using a controlled template. Execute this payload in the client-side Pyodide sandbox.",
    },
  };
}
