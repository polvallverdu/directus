import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire('/directus/package.json');
const apiDirectory = dirname(require.resolve('@directus/api/package.json'));
const marker = '// directus-custom-openai-responses-patch-v1';
const registryPath = join(apiDirectory, 'dist/ai/providers/registry.js');
const optionsPath = join(apiDirectory, 'dist/ai/providers/options.js');
const registry = readFileSync(registryPath, 'utf8');
const options = readFileSync(optionsPath, 'utf8');

if (registry.includes(marker) || options.includes(marker)) {
	assert(registry.includes(marker) && options.includes(marker), 'Only one provider file is patched');
	console.log('Responses patch is already installed');
	process.exit(0);
}

assert.equal(
	JSON.parse(readFileSync(join(apiDirectory, 'package.json'), 'utf8')).version,
	'39.2.1',
	'This patch supports @directus/api 39.2.1 (Directus 12.4.1) only',
);

const registryNeedle = 'providers["openai-compatible"] = createOpenAICompatible({';
const optionsNeedle = 'if (provider === "openai-compatible") {';
assert.equal(registry.split(registryNeedle).length, 2, 'Unexpected provider registry layout');
assert.equal(options.split(optionsNeedle).length, 2, 'Unexpected provider options layout');

const patchedRegistry = registry.replace(
	registryNeedle,
	`providers["openai-compatible"] = process.env.DIRECTUS_CUSTOM_OPENAI_API === "responses"
          ? createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, headers: customHeaders })
          : createOpenAICompatible({`,
);
const patchedOptions = options.replace(
	optionsNeedle,
	`${optionsNeedle}
    if (process.env.DIRECTUS_CUSTOM_OPENAI_API === "responses") {
      const customModel = settings.openaiCompatibleModels?.find((m) => m.id === model);
      return { openai: {
        store: false,
        ...(customModel?.reasoning ? {
          forceReasoning: true,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        } : {}),
        ...customModel?.providerOptions
      } };
    }`,
);

// Validate both files before writing either of them.
assert(patchedRegistry.includes('createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl'));
assert(patchedOptions.includes('forceReasoning: true'));
writeFileSync(registryPath, marker + '\n' + patchedRegistry);
writeFileSync(optionsPath, marker + '\n' + patchedOptions);
console.log('Installed Directus 12.4.1 custom-provider Responses patch');
