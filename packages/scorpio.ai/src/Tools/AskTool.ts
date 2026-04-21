import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Question Types ──────────────────────────────────────────────────────────

export enum AskQuestionType {
  Radio    = "radio",
  Checkbox = "checkbox",
  Input    = "input",
}

interface AskQuestionBase {
  label: string;
}

export interface RadioQuestion extends AskQuestionBase {
  type: AskQuestionType.Radio;
  options: string[];
}

export interface CheckboxQuestion extends AskQuestionBase {
  type: AskQuestionType.Checkbox;
  options: string[];
}

export interface InputQuestion extends AskQuestionBase {
  type: AskQuestionType.Input;
  placeholder?: string;
}

export type AskQuestion = RadioQuestion | CheckboxQuestion | InputQuestion;

export interface AskToolParams {
  title?: string;
  questions: AskQuestion[];
}

export type AskResponse = Record<string, string | string[]>;

export type AskUserFn = (params: AskToolParams) => Promise<AskResponse>;

// ── Zod Schema ──────────────────────────────────────────────────────────────

const RadioSchema = z.object({
  type: z.literal(AskQuestionType.Radio),
  label: z.string().describe("Question label displayed to the user"),
  options: z.array(z.string()).min(2).describe("Choices for single selection"),
});

const CheckboxSchema = z.object({
  type: z.literal(AskQuestionType.Checkbox),
  label: z.string().describe("Question label displayed to the user"),
  options: z.array(z.string()).min(1).describe("Choices for multiple selection"),
});

const InputSchema = z.object({
  type: z.literal(AskQuestionType.Input),
  label: z.string().describe("Question label displayed to the user"),
  placeholder: z.string().optional().describe("Placeholder text for the input field"),
});

const AskSchema = z.object({
  title: z.string().optional().describe("Optional title for the question dialog"),
  questions: z.array(
    z.discriminatedUnion("type", [RadioSchema, CheckboxSchema, InputSchema])
  ).min(1).describe("Array of questions to present to the user"),
});

// ── Factory ─────────────────────────────────────────────────────────────────

export const ASK_TOOL_NAME = "_ask";

const typeSchemas: Record<AskQuestionType, z.ZodObject<any>> = {
  [AskQuestionType.Radio]:    RadioSchema,
  [AskQuestionType.Checkbox]: CheckboxSchema,
  [AskQuestionType.Input]:    InputSchema,
};

export function createAskTool(askFn: AskUserFn, description: string, supportedTypes?: AskQuestionType[]): DynamicStructuredTool {
  let schema: z.ZodObject<any>;
  if (supportedTypes) {
    const schemas = supportedTypes.map(t => typeSchemas[t]);
    const questionSchema = schemas.length === 1
      ? schemas[0]
      : z.discriminatedUnion("type", schemas as [any, any, ...any[]]);
    schema = z.object({
      title: z.string().optional().describe("Optional title for the question dialog"),
      questions: z.array(questionSchema as any).min(1).describe("Array of questions to present to the user"),
    });
  } else {
    schema = AskSchema;
  }

  return new DynamicStructuredTool({
    name: ASK_TOOL_NAME,
    description,
    schema: schema as any,
    func: async (params: any): Promise<MCPToolResult> => {
      const response = await askFn(params as AskToolParams);
      return createSuccessResult(createTextContent(JSON.stringify(response)));
    },
  });
}
