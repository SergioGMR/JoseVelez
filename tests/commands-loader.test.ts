import { describe, expect, it } from 'bun:test';
import { loadCommands } from '../src/commands/index.js';

describe('loadCommands', () => {
	it('loads the expected command names', async () => {
		const { commandMap } = await loadCommands();
		const expectedCommands = [
			'buscar',
			'reproducir',
			'pausar',
			'reanudar',
			'saltar',
			'cola',
			'detener',
			'ayuda',
		];

		expectedCommands.forEach(name => {
			expect(commandMap.has(name)).toBe(true);
		});
	});
});
