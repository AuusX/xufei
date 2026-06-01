import { z } from "zod";
import mediaResolverFixturesJson from "../data/media-resolver-fixtures.json";
import { mediaCandidateKindSchema, mediaCandidateModeSchema } from "./schemas/media";

const mediaResolverFixtureSchema = z.object({
  id: z.string().min(1),
  kind: mediaCandidateKindSchema,
  mode: mediaCandidateModeSchema,
  name: z.string().min(1),
  website: z.string().optional(),
  limit: z.number().int().positive().optional(),
  expectedAutoLabel: z.string().nullable().optional(),
  expectedFirstBuiltInLabel: z.string().optional(),
  expectedMatchedQuery: z.string().optional(),
  expectedFirstFaviconProvider: z.string().optional(),
  expectedFirstFaviconLabel: z.string().optional(),
  expectedFaviconAutoAssignable: z.boolean().optional(),
}).strict();

export const mediaResolverFixtures = z.array(mediaResolverFixtureSchema).parse(mediaResolverFixturesJson);

export type MediaResolverFixture = (typeof mediaResolverFixtures)[number];
