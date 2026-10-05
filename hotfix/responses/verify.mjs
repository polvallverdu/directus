import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire('/directus/package.json');
const apiDirectory = dirname(require.resolve('@directus/api/package.json'));
const apiRequire = createRequire(join(apiDirectory, 'package.json'));
const { createAIProviderRegistry, buildProviderConfigs } = await import(
	pathToFileURL(join(apiDirectory, 'dist/ai/providers/registry.js'))
);
const { getProviderOptions } = await import(pathToFileURL(join(apiDirectory, 'dist/ai/providers/options.js')));
const { generateText, streamText, stepCountIs, tool, jsonSchema } = await import(
	pathToFileURL(apiRequire.resolve('ai'))
);
const settings = {
	openaiApiKey: null,
	anthropicApiKey: null,
	googleApiKey: null,
	openaiCompatibleApiKey: 'fake-test-key',
	openaiCompatibleBaseUrl: 'https://example.openai.azure.com/openai/v1/',
	openaiCompatibleName: 'Azure Foundry',
	openaiCompatibleHeaders: [{ header: 'X-Test', value: 'custom-header' }],
	openaiCompatibleModels: [
		{ id: 'my-sol-deployment', name: 'Sol', reasoning: true, providerOptions: { reasoningEffort: 'high' } },
	],
};
const requests = [];
const finalMessage = {
	type: 'message',
	id: 'msg_1',
	role: 'assistant',
	status: 'completed',
	content: [{ type: 'output_text', text: 'The answer is 42.', annotations: [] }],
};
const usage = {
	input_tokens: 10,
	output_tokens: 8,
	total_tokens: 18,
	input_tokens_details: { cached_tokens: 0 },
	output_tokens_details: { reasoning_tokens: 3 },
};
let responder;
globalThis.fetch = async (url, init) => {
	const request = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
	requests.push(request);
	return responder(request);
};
const response = (output) =>
	new Response(
		JSON.stringify({
			id: 'resp_' + requests.length,
			object: 'response',
			created_at: 1,
			status: 'completed',
			model: 'my-sol-deployment',
			output,
			usage,
		}),
		{ headers: { 'content-type': 'application/json' } },
	);

delete process.env.DIRECTUS_CUSTOM_OPENAI_API;
let registry = createAIProviderRegistry(buildProviderConfigs(settings), settings);
responder = () =>
	new Response(
		JSON.stringify({
			id: 'chat_test',
			object: 'chat.completion',
			created: 1,
			model: 'my-sol-deployment',
			choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Chat works' } }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}),
		{ headers: { 'content-type': 'application/json' } },
	);
assert.equal(
	(await generateText({ model: registry.languageModel('openai-compatible:my-sol-deployment'), prompt: 'Hello' })).text,
	'Chat works',
);
assert.equal(requests.at(-1).url, settings.openaiCompatibleBaseUrl + 'chat/completions');
assert.deepEqual(getProviderOptions('openai-compatible', 'my-sol-deployment', settings), {
	'Azure Foundry': { reasoningEffort: 'high' },
});
console.log('PASS default Chat Completions routing and existing provider options');

process.env.DIRECTUS_CUSTOM_OPENAI_API = 'responses';
registry = createAIProviderRegistry(buildProviderConfigs(settings), settings);
const options = getProviderOptions('openai-compatible', 'my-sol-deployment', settings);
assert.equal(options.openai.forceReasoning, true);
assert.equal(options.openai.store, false);
assert.equal(options.openai.reasoningEffort, 'high');
requests.length = 0;
let executions = 0;
responder = () =>
	requests.length === 1
		? response([
				{
					type: 'reasoning',
					id: 'rs_1',
					summary: [{ type: 'summary_text', text: 'I should use the tool.' }],
					encrypted_content: 'test-encrypted-reasoning',
				},
				{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{}', status: 'completed' },
			])
		: response([finalMessage]);
const result = await generateText({
	model: registry.languageModel('openai-compatible:my-sol-deployment'),
	providerOptions: options,
	prompt: 'Look up the answer',
	stopWhen: stepCountIs(2),
	tools: {
		lookup: tool({
			inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
			execute: async () => {
				executions++;
				return { answer: 42 };
			},
		}),
	},
});
assert.equal(result.text, 'The answer is 42.');
assert.equal(executions, 1);
assert.equal(requests.length, 2);
for (const request of requests) {
	assert.equal(request.url, settings.openaiCompatibleBaseUrl + 'responses');
	assert.equal(request.headers.get('authorization'), 'Bearer fake-test-key');
	assert.equal(request.headers.get('X-Test'), 'custom-header');
	assert.equal(request.body.model, 'my-sol-deployment');
	assert.equal(request.body.store, false);
	assert.deepEqual(request.body.reasoning, { effort: 'high', summary: 'auto' });
	assert(request.body.include.includes('reasoning.encrypted_content'));
}
assert(requests[1].body.input.some((item) => item.type === 'function_call_output' && item.call_id === 'call_1'));
assert(
	requests[1].body.input.some(
		(item) => item.type === 'reasoning' && item.encrypted_content === 'test-encrypted-reasoning',
	),
);
assert(!requests[1].body.input.some((item) => item.type === 'item_reference'));
console.log(
	'PASS Responses routing, Azure auth, deployment name, headers, reasoning effort, tool execution and encrypted reasoning replay',
);

const plainOptions = getProviderOptions('openai-compatible', 'plain', {
	...settings,
	openaiCompatibleModels: [{ id: 'plain', reasoning: false }],
});
assert.deepEqual(plainOptions, { openai: { store: false } });
assert.equal(
	getProviderOptions('openai-compatible', 'my-sol-deployment', {
		...settings,
		openaiCompatibleModels: [{ ...settings.openaiCompatibleModels[0], providerOptions: { reasoningEffort: 'low' } }],
	}).openai.reasoningEffort,
	'low',
);
console.log('PASS non-reasoning models and custom option overrides');

requests.length = 0;
responder = () => {
	const events = [
		{ type: 'response.created', response: { id: 'resp_stream', created_at: 1, model: 'my-sol-deployment' } },
		{
			type: 'response.output_item.added',
			output_index: 0,
			item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] },
		},
		{
			type: 'response.content_part.added',
			item_id: 'msg_1',
			output_index: 0,
			content_index: 0,
			part: { type: 'output_text', text: '', annotations: [] },
		},
		{ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Stream works' },
		{ type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text: 'Stream works' },
		{
			type: 'response.output_item.done',
			output_index: 0,
			item: { ...finalMessage, content: [{ type: 'output_text', text: 'Stream works', annotations: [] }] },
		},
		{ type: 'response.completed', response: { id: 'resp_stream', status: 'completed', usage } },
	];
	return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
		headers: { 'content-type': 'text/event-stream' },
	});
};
let streamError;
const stream = streamText({
	model: registry.languageModel('openai-compatible:my-sol-deployment'),
	providerOptions: options,
	prompt: 'Hello',
	onError: ({ error }) => {
		streamError = error;
	},
});
assert.equal(await stream.text, 'Stream works');
assert.equal(streamError, undefined);
assert.equal(requests[0].body.stream, true);
console.log('PASS Responses SSE streaming');
