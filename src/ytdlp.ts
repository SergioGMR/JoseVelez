import { spawn } from 'child_process';
import YTDlpWrap from 'yt-dlp-wrap';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';

const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const defaultBinaryPath = path.join(os.homedir(), '.cache', 'discord-music-bot', binaryName);

type YtDlpWrapConstructor = typeof import('yt-dlp-wrap').default;
type YtDlpWrapInstance = InstanceType<YtDlpWrapConstructor>;

const YtDlpWrap = YTDlpWrap as unknown as YtDlpWrapConstructor;

let ytDlpPromise: Promise<YtDlpWrapInstance> | null = null;
let availabilityPromise: Promise<boolean> | null = null;

const getAutoDownload = (): boolean => {
	const envValue = process.env.YTDLP_AUTO_DOWNLOAD?.toLowerCase();
	if (envValue === undefined) return true;

	return envValue === 'true' || envValue === '1' || envValue === 'yes';
};

const getEnvBinaryPath = (): string | undefined => process.env.YTDLP_PATH || process.env.YTDLP_BIN;

const resolveEnvBinaryPath = async (envBinaryPath: string): Promise<string> => {
	const resolvedPath = path.resolve(envBinaryPath);
	try {
		const stats = await fs.stat(resolvedPath);
		if (stats.isDirectory()) {
			return path.join(resolvedPath, binaryName);
		}
	} catch {
		const endsWithSlash = envBinaryPath.endsWith('/') || envBinaryPath.endsWith(path.sep);
		if (endsWithSlash) {
			return path.join(resolvedPath, binaryName);
		}
	}

	return resolvedPath;
};

const ensureStdoutArgs = (args: string[]): string[] => {
	if (args.includes('-o') || args.includes('--output')) {
		return args;
	}

	return [...args, '-o', '-'];
};

const resolveCookiesPath = async (): Promise<string | null> => {
	const envValue = process.env.YTDLP_COOKIES_PATH;
	if (!envValue) return null;

	const resolvedPath = path.resolve(envValue);
	try {
		await fs.access(resolvedPath, fsConstants.R_OK);
		return resolvedPath;
	} catch {
		console.warn(`YTDLP_COOKIES_PATH was set but is not readable: ${resolvedPath}`);
		return null;
	}
};

const resolvePlayerClient = (): string | null => {
	const envValue = process.env.YTDLP_PLAYER_CLIENT?.trim();
	return envValue ? envValue : null;
};

const resolvePoToken = (): string | null => {
	const envValue = process.env.YTDLP_PO_TOKEN?.trim();
	return envValue ? envValue : null;
};

const buildExtractorArgs = (): string | null => {
	const poToken = resolvePoToken();
	const playerClient = resolvePlayerClient() ?? (poToken ? 'default,mweb' : null);

	if (!poToken && !playerClient) return null;

	const parts: string[] = [];
	if (playerClient) {
		parts.push(`player-client=${playerClient}`);
	}

	if (poToken) {
		const normalizedToken = poToken.includes('+') ? poToken : `mweb.gvs+${poToken}`;
		parts.push(`po_token=${normalizedToken}`);
	}

	return `youtube:${parts.join(';')}`;
};

const buildYtDlpArgs = async (args: string[]): Promise<string[]> => {
	const cookiePath = await resolveCookiesPath();
	const extractorArgs = buildExtractorArgs();

	const mergedArgs: string[] = [];
	if (cookiePath) {
		mergedArgs.push('--cookies', cookiePath);
	}
	if (extractorArgs && !args.includes('--extractor-args')) {
		mergedArgs.push('--extractor-args', extractorArgs);
	}
	mergedArgs.push(...args);

	return ensureStdoutArgs(mergedArgs);
};

const ensureBinary = async (binaryPath: string, autoDownload: boolean): Promise<void> => {
	if (!autoDownload) return;

	try {
		const stats = await fs.stat(binaryPath);
		if (!stats.isFile()) {
			throw new Error('Invalid yt-dlp path');
		}
		await fs.access(binaryPath, fsConstants.X_OK);
	} catch {
		await fs.mkdir(path.dirname(binaryPath), { recursive: true });
		await YtDlpWrap.downloadFromGithub(binaryPath);
	}
};

const findBinaryOnPath = async (): Promise<string | null> => {
	const envPath = process.env.PATH;
	if (!envPath) return null;

	for (const entry of envPath.split(path.delimiter)) {
		if (!entry) continue;
		const candidate = path.join(entry, binaryName);
		try {
			await fs.access(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}

	return null;
};

const resolveBinaryPath = async (): Promise<string> => {
	const envBinaryPath = getEnvBinaryPath();
	const autoDownload = getAutoDownload();

	if (envBinaryPath) {
		const resolvedEnvPath = await resolveEnvBinaryPath(envBinaryPath);
		if (autoDownload) {
			await ensureBinary(resolvedEnvPath, autoDownload);
		}
		return resolvedEnvPath;
	}

	const pathBinary = await findBinaryOnPath();
	if (pathBinary) {
		return pathBinary;
	}

	if (autoDownload) {
		await ensureBinary(defaultBinaryPath, autoDownload);
		return defaultBinaryPath;
	}

	return 'yt-dlp';
};

export const getYtDlpWrap = async (): Promise<YtDlpWrapInstance> => {
	if (!ytDlpPromise) {
		ytDlpPromise = (async () => {
			const binaryPath = await resolveBinaryPath();
			return new YtDlpWrap(binaryPath);
		})();
	}

	return ytDlpPromise;
};

export const spawnYtDlpStream = async (args: string[]): Promise<NodeJS.ReadableStream> => {
	const binaryPath = await resolveBinaryPath();
	const ytDlpArgs = await buildYtDlpArgs(args);
	const ytDlpProcess = spawn(binaryPath, ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

	if (!ytDlpProcess.stdout) {
		throw new Error('yt-dlp no pudo iniciar stdout');
	}

	let stderr = '';
	if (ytDlpProcess.stderr) {
		ytDlpProcess.stderr.on('data', (chunk) => {
			if (stderr.length < 4000) {
				stderr += chunk.toString();
			}
		});
	}

	ytDlpProcess.once('error', (error) => {
		ytDlpProcess.stdout?.emit('error', error);
	});

	ytDlpProcess.once('close', (code) => {
		if (code && code !== 0) {
			const message = stderr.trim();
			const error = new Error(`yt-dlp fallo con codigo ${code}${message ? `: ${message}` : ''}`);
			ytDlpProcess.stdout?.emit('error', error);
		}
	});

	ytDlpProcess.stdout.once('close', () => {
		if (ytDlpProcess.exitCode === null) {
			ytDlpProcess.kill('SIGKILL');
		}
	});

	return ytDlpProcess.stdout;
};

export const ensureYtDlpAvailable = async (): Promise<boolean> => {
	if (!availabilityPromise) {
		availabilityPromise = (async () => {
			try {
				const ytDlp = await getYtDlpWrap();
				await ytDlp.getVersion();
				return true;
			} catch {
				return false;
			}
		})();
	}

	return availabilityPromise;
};
