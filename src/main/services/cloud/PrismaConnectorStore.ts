import type { PrismaClient } from 'generated/prisma/client';
import type {
  ConnectorAccountPatch,
  ConnectorAccountRow,
  ConnectorAccountStore,
} from './ConnectorStore';

export function createPrismaConnectorStore(getClient: () => PrismaClient): ConnectorAccountStore {
  const delegate = () => getClient().connectorAccount;
  return {
    async list() {
      return (await delegate().findMany({ orderBy: { id: 'asc' } })) as ConnectorAccountRow[];
    },
    async get(id) {
      return ((await delegate().findUnique({ where: { id } })) as ConnectorAccountRow | null) ?? null;
    },
    async create(input) {
      return (await delegate().create({
        data: {
          connectorKind: input.connectorKind,
          label: input.label,
          authKind: input.authKind,
          keyringRef: input.keyringRef,
          scopes: input.scopes as never,
          status: input.status,
        },
      })) as ConnectorAccountRow;
    },
    async update(id, patch: ConnectorAccountPatch) {
      return ((await delegate().update({
        where: { id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.scopes !== undefined ? { scopes: patch.scopes as never } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
          ...(patch.keyringRef !== undefined ? { keyringRef: patch.keyringRef } : {}),
        },
      })) as ConnectorAccountRow | null) ?? null;
    },
    async remove(id) {
      await delegate().delete({ where: { id } });
    },
  };
}
