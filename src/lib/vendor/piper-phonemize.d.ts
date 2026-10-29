export interface PiperPhonemizer {
  callMain(args: string[]): void;
}
export function createPiperPhonemize(opts: { print?: (line: string) => void; printErr?: (line: string) => void; locateFile?: (name: string) => string }): Promise<PiperPhonemizer>;
