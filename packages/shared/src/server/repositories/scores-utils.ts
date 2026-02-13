/**
 * Scores utils - PostgreSQL-only implementation.
 */

import { ScoreDataTypeType, ScoreDomain, ScoreSourceType } from "../../domain";
import { prisma } from "../../db";
import { convertPrismaScoreToRecord } from "./postgres";
import { convertClickhouseScoreToDomain } from "./scores_converters";
import { ScoreRecordReadType } from "./definitions";

export const _handleGetScoreById = async ({
  projectId,
  scoreId,
  source,
  scoreScope,
  scoreDataTypes,
}: {
  projectId: string;
  scoreId: string;
  source?: ScoreSourceType;
  scoreScope: "traces_only" | "all";
  scoreDataTypes?: readonly ScoreDataTypeType[];
  preferredClickhouseService?: any;
}): Promise<ScoreDomain | undefined> => {
  const where: any = { projectId, id: scoreId };
  if (source) where.source = source;
  if (scoreDataTypes) where.dataType = { in: scoreDataTypes };

  const score = await prisma.pgScore.findFirst({ where });
  if (!score) return undefined;

  const record = convertPrismaScoreToRecord(score) as ScoreRecordReadType;
  return convertClickhouseScoreToDomain(record);
};

export const _handleGetScoresByIds = async ({
  projectId,
  scoreId,
  source,
  scoreScope,
  dataTypes,
}: {
  projectId: string;
  scoreId: string[];
  source?: ScoreSourceType;
  scoreScope: "traces_only" | "all";
  dataTypes?: readonly ScoreDataTypeType[];
}): Promise<ScoreDomain[]> => {
  const where: any = { projectId, id: { in: scoreId } };
  if (source) where.source = source;
  if (dataTypes) where.dataType = { in: dataTypes };

  const scores = await prisma.pgScore.findMany({ where });
  return scores
    .map(convertPrismaScoreToRecord)
    .map((r) => convertClickhouseScoreToDomain(r as ScoreRecordReadType));
};
