import { createClient } from '@libsql/client';
import type { Client as TursoClient, InValue } from '@libsql/client';
import { MastraVector } from '@mastra/core/vector';
import type {
  IndexStats,
  QueryResult,
  QueryVectorParams,
  CreateIndexParams,
  UpsertVectorParams,
  ParamsToArgs,
  QueryVectorArgs,
} from '@mastra/core/vector';
import type { VectorFilter } from '@mastra/core/vector/filter';
import { LibSQLFilterTranslator } from './filter';
import { buildFilterQuery } from './sql-builder';

interface LibSQLQueryParams extends QueryVectorParams {
  minScore?: number;
}

type LibSQLQueryArgs = [...QueryVectorArgs, number?];

export class LibSQLVector extends MastraVector {
  private turso: TursoClient;

  constructor({
    connectionUrl,
    authToken,
    syncUrl,
    syncInterval,
  }: {
    connectionUrl: string;
    authToken?: string;
    syncUrl?: string;
    syncInterval?: number;
  }) {
    super();

    this.turso = createClient({
      url: connectionUrl,
      syncUrl: syncUrl,
      authToken,
      syncInterval,
    });

    if (connectionUrl.includes(`file:`) || connectionUrl.includes(`:memory:`)) {
      void this.turso.execute({
        sql: 'PRAGMA journal_mode=WAL;',
        args: {},
      });
    }
  }

  transformFilter(filter?: VectorFilter) {
    const translator = new LibSQLFilterTranslator();
    return translator.translate(filter);
  }

  async query(...args: ParamsToArgs<LibSQLQueryParams> | LibSQLQueryArgs): Promise<QueryResult[]> {
    const params = this.normalizeArgs<LibSQLQueryParams, LibSQLQueryArgs>('query', args, ['minScore']);

    try {
      const { indexName, queryVector, topK = 10, filter, includeVector = false, minScore = 0 } = params;

      const vectorStr = `[${queryVector.join(',')}]`;

      const translatedFilter = this.transformFilter(filter);
      const { sql: filterQuery, values: filterValues } = buildFilterQuery(translatedFilter);
      filterValues.push(minScore);

      const query = `
        WITH vector_scores AS (
          SELECT
            vector_id as id,
            (1-vector_distance_cos(embedding, '${vectorStr}')) as score,
            metadata
            ${includeVector ? ', vector_extract(embedding) as embedding' : ''}
          FROM ${indexName}
          ${filterQuery}
        )
        SELECT *
        FROM vector_scores
        WHERE score > ?
        ORDER BY score DESC
        LIMIT ${topK}`;

      const result = await this.turso.execute({
        sql: query,
        args: filterValues,
      });

      return result.rows.map(({ id, score, metadata, embedding }) => ({
        id: id as string,
        score: score as number,
        metadata: JSON.parse((metadata as string) ?? '{}'),
        ...(includeVector && embedding && { vector: JSON.parse(embedding as string) }),
      }));
    } finally {
      // client.release()
    }
  }

  async upsert(...args: ParamsToArgs<UpsertVectorParams>): Promise<string[]> {
    const params = this.normalizeArgs<UpsertVectorParams>('upsert', args);

    const { indexName, vectors, metadata, ids } = params;
    const tx = await this.turso.transaction('write');

    try {
      const vectorIds = ids || vectors.map(() => crypto.randomUUID());

      for (let i = 0; i < vectors.length; i++) {
        const query = `
          INSERT INTO ${indexName} (vector_id, embedding, metadata)
          VALUES (?, vector32(?), ?)
          ON CONFLICT(vector_id) DO UPDATE SET
            embedding = vector32(?),
            metadata = ?
        `;

        // console.log('INSERTQ', query, [
        //   vectorIds[i] as InValue,
        //   JSON.stringify(vectors[i]),
        //   JSON.stringify(metadata?.[i] || {}),
        //   JSON.stringify(vectors[i]),
        //   JSON.stringify(metadata?.[i] || {}),
        // ]);
        await tx.execute({
          sql: query,
          // @ts-ignore
          args: [
            vectorIds[i] as InValue,
            JSON.stringify(vectors[i]),
            JSON.stringify(metadata?.[i] || {}),
            JSON.stringify(vectors[i]),
            JSON.stringify(metadata?.[i] || {}),
          ],
        });
      }

      await tx.commit();
      return vectorIds;
    } catch (error) {
      await tx.rollback();
      if (error instanceof Error && error.message?.includes('dimensions are different')) {
        const match = error.message.match(/dimensions are different: (\d+) != (\d+)/);
        if (match) {
          const [, actual, expected] = match;
          throw new Error(
            `Vector dimension mismatch: Index "${indexName}" expects ${expected} dimensions but got ${actual} dimensions. ` +
              `Either use a matching embedding model or delete and recreate the index with the new dimension.`,
          );
        }
      }
      throw error;
    }
  }

  async createIndex(...args: ParamsToArgs<CreateIndexParams>): Promise<void> {
    const params = this.normalizeArgs<CreateIndexParams>('createIndex', args);

    const { indexName, dimension } = params;
    try {
      // Validate inputs
      if (!indexName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        throw new Error('Invalid index name format');
      }
      if (!Number.isInteger(dimension) || dimension <= 0) {
        throw new Error('Dimension must be a positive integer');
      }

      // Create the table with explicit schema
      await this.turso.execute({
        sql: `
        CREATE TABLE IF NOT EXISTS ${indexName} (
          id SERIAL PRIMARY KEY,
          vector_id TEXT UNIQUE NOT NULL,
          embedding F32_BLOB(${dimension}),
          metadata TEXT DEFAULT '{}'
        );
      `,
        args: [],
      });

      await this.turso.execute({
        sql: `
        CREATE INDEX IF NOT EXISTS ${indexName}_vector_idx
        ON ${indexName} (libsql_vector_idx(embedding))
      `,
        args: [],
      });
    } catch (error: any) {
      console.error('Failed to create vector table:', error);
      throw error;
    } finally {
      // client.release()
    }
  }

  async deleteIndex(indexName: string): Promise<void> {
    try {
      // Drop the table
      await this.turso.execute({
        sql: `DROP TABLE IF EXISTS ${indexName}`,
        args: [],
      });
    } catch (error: any) {
      console.error('Failed to delete vector table:', error);
      throw new Error(`Failed to delete vector table: ${error.message}`);
    } finally {
      // client.release()
    }
  }

  async listIndexes(): Promise<string[]> {
    try {
      const vectorTablesQuery = `
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND sql LIKE '%F32_BLOB%';
      `;
      const result = await this.turso.execute({
        sql: vectorTablesQuery,
        args: [],
      });
      return result.rows.map(row => row.name as string);
    } catch (error: any) {
      throw new Error(`Failed to list vector tables: ${error.message}`);
    }
  }

  async describeIndex(indexName: string): Promise<IndexStats> {
    try {
      // Get table info including column info
      const tableInfoQuery = `
        SELECT sql 
        FROM sqlite_master 
        WHERE type='table' 
        AND name = ?;
      `;
      const tableInfo = await this.turso.execute({
        sql: tableInfoQuery,
        args: [indexName],
      });

      if (!tableInfo.rows[0]?.sql) {
        throw new Error(`Table ${indexName} not found`);
      }

      // Extract dimension from F32_BLOB definition
      const dimension = parseInt((tableInfo.rows[0].sql as string).match(/F32_BLOB\((\d+)\)/)?.[1] || '0');

      // Get row count
      const countQuery = `
        SELECT COUNT(*) as count
        FROM ${indexName};
      `;
      const countResult = await this.turso.execute({
        sql: countQuery,
        args: [],
      });

      // LibSQL only supports cosine similarity currently
      const metric: 'cosine' | 'euclidean' | 'dotproduct' = 'cosine';

      return {
        dimension,
        count: (countResult?.rows?.[0]?.count as number) ?? 0,
        metric,
      };
    } catch (e: any) {
      throw new Error(`Failed to describe vector table: ${e.message}`);
    }
  }

  /**
   * Updates an index entry by its ID with the provided vector and/or metadata.
   *
   * @param indexName - The name of the index to update.
   * @param id - The ID of the index entry to update.
   * @param update - An object containing the vector and/or metadata to update.
   * @param update.vector - An optional array of numbers representing the new vector.
   * @param update.metadata - An optional record containing the new metadata.
   * @returns A promise that resolves when the update is complete.
   * @throws Will throw an error if no updates are provided or if the update operation fails.
   */
  async updateIndexById(
    indexName: string,
    id: string,
    update: { vector?: number[]; metadata?: Record<string, any> },
  ): Promise<void> {
    try {
      const updates = [];
      const args: InValue[] = [];

      if (update.vector) {
        updates.push('embedding = vector32(?)');
        args.push(JSON.stringify(update.vector));
      }

      if (update.metadata) {
        updates.push('metadata = ?');
        args.push(JSON.stringify(update.metadata));
      }

      if (updates.length === 0) {
        throw new Error('No updates provided');
      }

      args.push(id);

      const query = `
        UPDATE ${indexName}
        SET ${updates.join(', ')}
        WHERE vector_id = ?;
      `;

      await this.turso.execute({
        sql: query,
        args,
      });
    } catch (error: any) {
      throw new Error(`Failed to update index by id: ${id} for index: ${indexName}: ${error.message}`);
    }
  }

  async deleteIndexById(indexName: string, id: string): Promise<void> {
    try {
      await this.turso.execute({
        sql: `DELETE FROM ${indexName} WHERE vector_id = ?`,
        args: [id],
      });
    } catch (error: any) {
      throw new Error(`Failed to delete index by id: ${id} for index: ${indexName}: ${error.message}`);
    }
  }

  async truncateIndex(indexName: string) {
    await this.turso.execute({
      sql: `DELETE FROM ${indexName}`,
      args: [],
    });
  }
}
