/**
 * YamX - Tool Registry
 * Central registry for all 20+ agent tools.
 */

import { ToolDefinition } from '../providers/base.js';

export interface Tool {
  definition: ToolDefinition;
  execute(args: any): Promise<string>;
  needsApproval?: boolean;
  isDangerous?(args: any): boolean;
}

import { readFile, writeFile, editFile, listFiles, searchFiles, deleteFile } from './filesystem.js';
import { runCommand, runCommandBackground } from './shell.js';
import { gitStatus, gitDiff, gitCommit, gitLog, gitBranch, gitStash } from './git.js';
import { fetchUrlTool } from './web.js';
import { multiEdit, copyFile, moveFile, fileInfo } from './advanced.js';

/** All available tools — 20 tools */
export const allTools: Record<string, Tool> = {
  // File System (core)
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  list_files: listFiles,
  search_files: searchFiles,
  delete_file: deleteFile,

  // File System (advanced)
  multi_edit: multiEdit,
  copy_file: copyFile,
  move_file: moveFile,
  file_info: fileInfo,

  // Shell
  run_command: runCommand,
  run_command_background: runCommandBackground,

  // Git
  git_status: gitStatus,
  git_diff: gitDiff,
  git_commit: gitCommit,
  git_log: gitLog,
  git_branch: gitBranch,
  git_stash: gitStash,

  // Web
  fetch_url: fetchUrlTool,
};

/** Get tool definitions for the provider */
export function getToolDefinitions(): ToolDefinition[] {
  return Object.values(allTools).map(t => t.definition);
}

/** Get a tool by name */
export function getTool(name: string): Tool | undefined {
  return allTools[name];
}

/** Get tool count */
export function getToolCount(): number {
  return Object.keys(allTools).length;
}
