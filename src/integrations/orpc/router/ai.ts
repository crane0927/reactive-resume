import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, generateText, streamText } from "ai";
import { createOllama } from "ai-sdk-ollama";
import { match } from "ts-pattern";
import z, { flattenError, ZodError } from "zod";
import { createZhipu } from "zhipu-ai-provider";
import docxParserSystemPrompt from "@/integrations/ai/prompts/docx-parser-system.md?raw";
import docxParserUserPrompt from "@/integrations/ai/prompts/docx-parser-user.md?raw";
import markdownParserSystemPrompt from "@/integrations/ai/prompts/markdown-parser-system.md?raw";
import markdownParserUserPrompt from "@/integrations/ai/prompts/markdown-parser-user.md?raw";
import pdfParserSystemPrompt from "@/integrations/ai/prompts/pdf-parser-system.md?raw";
import pdfParserUserPrompt from "@/integrations/ai/prompts/pdf-parser-user.md?raw";
import { defaultResumeData, resumeDataSchema } from "@/schema/resume/data";
import { protectedProcedure } from "../context";

const aiProviderSchema = z.enum(["ollama", "openai", "gemini", "anthropic", "vercel-ai-gateway", "zhipu"]);

type AIProvider = z.infer<typeof aiProviderSchema>;

type GetModelInput = {
	provider: AIProvider;
	model: string;
	apiKey: string;
	baseURL: string;
};

function getModel(input: GetModelInput) {
	const { provider, model, apiKey } = input;
	const baseURL = input.baseURL || undefined;

	return match(provider)
		.with("openai", () => createOpenAI({ apiKey, baseURL }).languageModel(model))
		.with("ollama", () => createOllama({ apiKey, baseURL }).languageModel(model))
		.with("anthropic", () => createAnthropic({ apiKey, baseURL }).languageModel(model))
		.with("vercel-ai-gateway", () => createGateway({ apiKey, baseURL }).languageModel(model))
		.with("gemini", () => createGoogleGenerativeAI({ apiKey, baseURL }).languageModel(model))
		.with("zhipu", () => createZhipu({ apiKey, baseURL: baseURL || undefined })(model))
		.exhaustive();
}

const aiCredentialsSchema = z.object({
	provider: aiProviderSchema,
	model: z.string(),
	apiKey: z.string(),
	baseURL: z.string(),
});

const fileInputSchema = z.object({
	name: z.string(),
	data: z.string(), // base64 encoded
});

// Helper function to parse AI response JSON
function parseAIResponse(text: string): Record<string, unknown> {
	const jsonText = text.trim();
	// Remove markdown code blocks if present
	const cleanJson = jsonText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
	return JSON.parse(cleanJson) as Record<string, unknown>;
}

export const aiRouter = {
	testConnection: protectedProcedure
		.input(
			z.object({
				provider: aiProviderSchema,
				model: z.string(),
				apiKey: z.string(),
				baseURL: z.string(),
			}),
		)
		.handler(async function* ({ input }) {
			const stream = streamText({
				temperature: 0,
				model: getModel(input),
				messages: [{ role: "user", content: 'Respond with "1"' }],
			});

			yield* stream.textStream;
		}),

	parsePdf: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				file: fileInputSchema,
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{
							role: "system",
							content: pdfParserSystemPrompt,
						},
						{
							role: "user",
							content: [
								{ type: "text", text: pdfParserUserPrompt },
								{
									type: "file",
									filename: input.file.name,
									mediaType: "application/pdf",
									data: input.file.data,
								},
							],
						},
					],
				});

				const parsed = parseAIResponse(result.text);

				return resumeDataSchema.parse({
					...parsed,
					customSections: [],
					picture: defaultResumeData.picture,
					metadata: defaultResumeData.metadata,
				});
			} catch (error) {
				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),

	parseDocx: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				file: fileInputSchema,
				mediaType: z.enum([
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				]),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{ role: "system", content: docxParserSystemPrompt },
						{
							role: "user",
							content: [
								{ type: "text", text: docxParserUserPrompt },
								{
									type: "file",
									filename: input.file.name,
									mediaType: input.mediaType,
									data: input.file.data,
								},
							],
						},
					],
				});

				const parsed = parseAIResponse(result.text);

				return resumeDataSchema.parse({
					...parsed,
					customSections: [],
					picture: defaultResumeData.picture,
					metadata: defaultResumeData.metadata,
				});
			} catch (error) {
				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),

	parseMarkdown: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				content: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{ role: "system", content: markdownParserSystemPrompt },
						{
							role: "user",
							content: `${markdownParserUserPrompt}\n\n---\n\n${input.content}`,
						},
					],
				});

				const parsed = parseAIResponse(result.text);

				return resumeDataSchema.parse({
					...parsed,
					customSections: [],
					picture: defaultResumeData.picture,
					metadata: defaultResumeData.metadata,
				});
			} catch (error) {
				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),
};
