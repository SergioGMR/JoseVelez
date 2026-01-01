import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import chalk from 'chalk';
import type { SlashCommand } from './types.js';

type CommandRegistry = {
	commandList: SlashCommand[];
	commandMap: Map<string, SlashCommand>;
	commandData: ReturnType<SlashCommand['data']['toJSON']>[];
};

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.js']);
const EXCLUDED_FILES = new Set([
	'index.ts',
	'index.js',
	'types.ts',
	'types.js',
	'helpers.ts',
	'helpers.js',
	'play-utils.ts',
	'play-utils.js',
]);

let cachedRegistry: CommandRegistry | null = null;

const isCommandFile = (fileName: string): boolean => {
	if (fileName.endsWith('.d.ts')) return false;
	if (EXCLUDED_FILES.has(fileName)) return false;

	const extension = path.extname(fileName);
	return SUPPORTED_EXTENSIONS.has(extension);
};

export const loadCommands = async (): Promise<CommandRegistry> => {
	if (cachedRegistry) return cachedRegistry;

	const directory = path.dirname(fileURLToPath(import.meta.url));
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const commandFiles = entries
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.filter(isCommandFile)
		.sort((a, b) => a.localeCompare(b));

	const commandList: SlashCommand[] = [];
	const commandNames = new Set<string>();

	for (const fileName of commandFiles) {
		const moduleUrl = pathToFileURL(path.join(directory, fileName)).href;
		const moduleExports = await import(moduleUrl);
		const command = (moduleExports.default ?? moduleExports.command) as SlashCommand | undefined;

		if (!command) {
			console.warn(chalk.yellow(`Command module ${fileName} has no default export.`));
			continue;
		}

		if (!command.data?.name || typeof command.execute !== 'function') {
			console.warn(chalk.yellow(`Command module ${fileName} is missing required fields.`));
			continue;
		}

		if (commandNames.has(command.data.name)) {
			console.warn(chalk.yellow(`Duplicate command name detected: ${command.data.name}`));
			continue;
		}

		commandNames.add(command.data.name);
		commandList.push(command);
	}

	if (commandList.length === 0) {
		console.warn(chalk.yellow('No slash commands were loaded.'));
	}

	const commandMap = new Map(commandList.map(command => [command.data.name, command]));
	const commandData = commandList.map(command => command.data.toJSON());

	cachedRegistry = { commandList, commandMap, commandData };
	return cachedRegistry;
};
