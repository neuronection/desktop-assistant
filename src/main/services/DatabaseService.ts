import { app } from 'electron';
import type { PrismaClient } from 'generated/prisma/client';
import { bootDatabase, openDatabase } from '@main/db';
import { getDatabasePath, getAppDataPath } from '@main/utils/config';
import { setAiAuditClientProvider } from '@main/ai/audit';
import { setMemoryClientProvider } from '@main/services/MemoryService';
import { setDocsIndexClientProvider } from '@main/services/DocsIndexService';
import { setToolResultClientProvider } from '@main/services/ToolResultService';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { promises as fs } from 'fs';

export class DatabaseService {
  private prisma: PrismaClient | null = null;
  private isInitialized = false;
  private databasePath: string;

  constructor() {
    this.databasePath = getDatabasePath();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.ensureDatabaseDirectory();

      this.prisma = await openDatabase(
        this.databasePath,
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
      );

      const schemaSqlPath = app.isPackaged
        ? path.join(process.resourcesPath, 'resources/schema.sql')
        : path.join(app.getAppPath(), 'src/main/resources/schema.sql');
      const schemaSql = await fs.readFile(schemaSqlPath, 'utf-8');
      const bootPath = await bootDatabase(this.prisma, schemaSql);

      this.isInitialized = true;
      setAiAuditClientProvider(() => this.prisma);
      setMemoryClientProvider(() => this.prisma!);
      setToolResultClientProvider(() => this.prisma);
      setDocsIndexClientProvider(() => this.prisma!);
      console.log(`Database initialized (${bootPath}) at: ${this.databasePath}`);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      console.error(`Database directory: ${this.databasePath}`);
      if (error instanceof Error) {
        throw new Error(`Database initialization failed: ${error.message}`);
      }
      throw new Error(`Database initialization failed with an unknown error: ${String(error)}`);
    }
  }

  private async ensureDatabaseDirectory(): Promise<void> {
    const dbDir = getAppDataPath();
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  }

  getClient(): PrismaClient {
    if (!this.prisma) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.prisma;
  }

  isReady(): boolean {
    return this.isInitialized && this.prisma !== null;
  }

  async cleanup(): Promise<void> {
    if (this.prisma) {
      try {
        await this.prisma.$disconnect();
      } catch (error) {
        console.error('Error closing database connection:', error);
      } finally {
        this.prisma = null;
        this.isInitialized = false;
      }
    }
  }
}
