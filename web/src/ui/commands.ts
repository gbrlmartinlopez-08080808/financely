// Commands the open document offers (rotate pages, save, find…): the palette lists them next to the global ones.
export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  run: () => void;
}
const owners = new Map<string, Command[]>();
export const registerCommands = (owner: string, cmds: Command[]) => void owners.set(owner, cmds);
export const dropCommands = (owner: string) => void owners.delete(owner);
export const commandsOf = (owner: string) => owners.get(owner) ?? [];
