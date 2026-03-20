import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Question Types ──────────────────────────────────────────────────────────

export enum AskQuestionType {
  Radio    = "radio",
  Checkbox = "checkbox",
  Input    = "input",
  Toggle   = "toggle",
}

interface AskQuestionBase {
  label: string;
}

export interface RadioQuestion extends AskQuestionBase {
  type: AskQuestionType.Radio;
  options: string[];
  allowCustom?: boolean;
}

export interface CheckboxQuestion extends AskQuestionBase {
  type: AskQuestionType.Checkbox;
  options: string[];
  allowCustom?: boolean;
}

export interface InputQuestion extends AskQuestionBase {
  type: AskQuestionType.Input;
  placeholder?: string;
}

export interface ToggleQuestion extends AskQuestionBase {
  type: AskQuestionType.Toggle;
  default?: boolean;
}

export type AskQuestion = RadioQuestion | CheckboxQuestion | InputQuestion | ToggleQuestion;

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
  allowCustom: z.boolean().optional().describe("Show an extra 'Other' option with a text input"),
});

const CheckboxSchema = z.object({
  type: z.literal(AskQuestionType.Checkbox),
  label: z.string().describe("Question label displayed to the user"),
  options: z.array(z.string()).min(1).describe("Choices for multiple selection"),
  allowCustom: z.boolean().optional().describe("Show an extra 'Other' option with a text input"),
});

const InputSchema = z.object({
  type: z.literal(AskQuestionType.Input),
  label: z.string().describe("Question label displayed to the user"),
  placeholder: z.string().optional().describe("Placeholder text for the input field"),
});

const ToggleSchema = z.object({
  type: z.literal(AskQuestionType.Toggle),
  label: z.string().describe("Question label displayed to the user"),
  default: z.boolean().optional().describe("Default checked state, defaults to false"),
});

const AskSchema = z.object({
  title: z.string().optional().describe("Optional title for the question dialog"),
  questions: z.array(
    z.discriminatedUnion("type", [RadioSchema, CheckboxSchema, InputSchema, ToggleSchema])
  ).min(1).describe("Array of questions to present to the user"),
});

// ── Factory ─────────────────────────────────────────────────────────────────

export const ASK_TOOL_NAME = "_ask";

export function createAskTool(askFn: AskUserFn, description: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: ASK_TOOL_NAME,
    description,
    schema: AskSchema as any,
    func: async (params: any): Promise<MCPToolResult> => {
      const response = await askFn(params as AskToolParams);
      return createSuccessResult(createTextContent(JSON.stringify(response)));
    },
  });
}
