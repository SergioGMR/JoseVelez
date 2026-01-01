import fs from 'fs/promises';

const USAGE = `Usage:
  bun scripts/extract-po-token.ts <payload.json>
  cat payload.json | bun scripts/extract-po-token.ts -`;

const readStdin = async (): Promise<string> =>
	new Promise(resolve => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', chunk => {
			data += chunk;
		});
		process.stdin.on('end', () => resolve(data));
	});

const extractPoToken = (input: string): string | null => {
	try {
		const parsed = JSON.parse(input);
		const token = parsed?.serviceIntegrityDimensions?.poToken ?? parsed?.poToken;
		return typeof token === 'string' && token.trim() ? token.trim() : null;
	} catch {
		const match = input.match(/"poToken"\s*:\s*"([^"]+)"/);
		return match ? match[1] : null;
	}
};

const main = async (): Promise<void> => {
	const arg = process.argv[2];
	if (!arg) {
		console.error(USAGE);
		process.exit(1);
	}

	const input = arg === '-' ? await readStdin() : await fs.readFile(arg, 'utf8');
	const token = extractPoToken(input);

	if (!token) {
		console.error('No poToken found in the input payload.');
		process.exit(1);
	}

	console.log(`YTDLP_PO_TOKEN=${token}`);
	console.log('YTDLP_PLAYER_CLIENT=default,mweb');
};

main().catch(error => {
	console.error('Failed to extract PO token:', error);
	process.exit(1);
});
