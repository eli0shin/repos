import { afterAll } from 'bun:test';
import { isolateHerdrEnvironment } from './utils.ts';

// Test setup - runs before all tests
const restoreHerdrEnvironment = isolateHerdrEnvironment(process.env);
afterAll(restoreHerdrEnvironment);
