"use client";

import { createContext, useContext } from "react";
import type { BlobReader } from "@/collab/share";
import type { ServerClient } from "@/server-client/client";

/** The server the Studio is signed in to, for an assignment too large for a link. Null where there is none. */
export type AssignmentServer = { client: ServerClient; readBlob: BlobReader };

const ServerContext = createContext<AssignmentServer | null>(null);

export const AssignmentServerProvider = ServerContext.Provider;

export const useAssignmentServer = (): AssignmentServer | null => useContext(ServerContext);
