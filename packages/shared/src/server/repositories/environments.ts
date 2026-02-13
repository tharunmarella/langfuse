/**
 * Environments repository - PostgreSQL-only implementation.
 */

import { prisma } from "../../db";

export type EnvironmentFilterProps = {
  projectId: string;
  fromTimestamp?: Date;
};

export const getEnvironmentsForProject = async (
  props: EnvironmentFilterProps,
): Promise<{ environment: string }[]> => {
  const { projectId } = props;

  const traceEnvs = await prisma.pgTrace.findMany({
    where: { projectId },
    distinct: ["environment"],
    select: { environment: true },
  });

  const obsEnvs = await prisma.pgObservation.findMany({
    where: { projectId },
    distinct: ["environment"],
    select: { environment: true },
  });

  const scoreEnvs = await prisma.pgScore.findMany({
    where: { projectId },
    distinct: ["environment"],
    select: { environment: true },
  });

  const allEnvs = new Set<string>(["default"]);
  for (const e of traceEnvs) allEnvs.add(e.environment);
  for (const e of obsEnvs) allEnvs.add(e.environment);
  for (const e of scoreEnvs) allEnvs.add(e.environment);

  return Array.from(allEnvs).map((environment) => ({ environment }));
};
