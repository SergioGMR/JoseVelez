import { spawn } from 'child_process';
import YTDlpWrap from 'yt-dlp-wrap';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';

const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const defaultBinaryPath = path.join(os.homedir(), '.cache', 'discord-music-bot', binaryName);

let ytDlpPromise: Promise<YTDlpWrap> | null = null;
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
		await YTDlpWrap.downloadFromGithub(binaryPath);
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

export const getYtDlpWrap = async (): Promise<YTDlpWrap> => {
	if (!ytDlpPromise) {
		ytDlpPromise = (async () => {
			const binaryPath = await resolveBinaryPath();
			return new YTDlpWrap(binaryPath);
		})();
	}

	return ytDlpPromise;
};

export const spawnYtDlpStream = async (args: string[]): Promise<NodeJS.ReadableStream> => {
	const binaryPath = await resolveBinaryPath();
	const ytDlpArgs = ensureStdoutArgs(args);
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
