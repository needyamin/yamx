import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  whenToUse?: string;
  requiredTools?: string[];
}

export class SkillManager {
  private cwd: string;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
  }

  async load(): Promise<SkillSummary[]> {
    const roots = [
      path.join(this.cwd, 'skills'),
      path.join(this.cwd, '.yamx', 'skills'),
      path.join(os.homedir(), '.yamx', 'skills'),
    ];

    const byName = new Map<string, SkillSummary>();
    for (const root of roots) {
      const files = await fg('*/SKILL.md', {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true,
      });

      for (const file of files.sort()) {
        const skill = await this.readSkill(file);
        if (!skill) continue;
        byName.set(skill.name, skill);
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async promptBlock(maxSkills = 20): Promise<string> {
    const skills = (await this.load()).slice(0, maxSkills);
    if (skills.length === 0) return 'No YamX skills found.';
    return skills
      .map((skill) => {
        const lines = [
          `- ${skill.name}: ${skill.description || 'No description.'}`,
          skill.whenToUse ? `  when_to_use: ${skill.whenToUse}` : '',
          skill.requiredTools?.length ? `  tools: ${skill.requiredTools.join(', ')}` : '',
          `  path: ${skill.path}`,
        ].filter(Boolean);
        return lines.join('\n');
      })
      .join('\n');
  }

  async describe(): Promise<string> {
    const skills = await this.load();
    if (skills.length === 0) {
      return [
        'No skills found.',
        `Checked: ${path.join(this.cwd, 'skills')}`,
        `Checked: ${path.join(this.cwd, '.yamx', 'skills')}`,
        `Checked: ${path.join(os.homedir(), '.yamx', 'skills')}`,
      ].join('\n');
    }

    return skills
      .map((skill) => `${skill.name}\n  ${skill.description || 'No description.'}\n  ${skill.path}`)
      .join('\n\n');
  }

  private async readSkill(file: string): Promise<SkillSummary | null> {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const frontmatter = this.parseFrontmatter(raw);
      const fallbackName = path.basename(path.dirname(file));
      return {
        name: String(frontmatter.name || fallbackName).trim(),
        description: String(frontmatter.description || this.firstHeading(raw) || '').trim(),
        whenToUse: frontmatter.when_to_use || frontmatter.whenToUse,
        requiredTools: this.toList(frontmatter.required_tools || frontmatter.requiredTools || frontmatter.tools),
        path: file,
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(raw: string): Record<string, any> {
    if (!raw.startsWith('---')) return {};
    const end = raw.indexOf('\n---', 3);
    if (end === -1) return {};
    const body = raw.slice(3, end).trim();
    const out: Record<string, any> = {};

    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;
      if (value.startsWith('[') && value.endsWith(']')) {
        out[key] = value.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        out[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    return out;
  }

  private firstHeading(raw: string): string | undefined {
    const line = raw.split(/\r?\n/).find((l) => l.startsWith('# '));
    return line?.replace(/^#\s+/, '').trim();
  }

  private toList(value: unknown): string[] | undefined {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean);
    return undefined;
  }
}
