// PRD §17.4/§20.3: pure resource-ownership check. The DB/JWT lookups that
// produce `actorId`/`resourceOwnerId` happen in the guard or handler; this
// function only decides.
export function isSelf(actorId: string, resourceOwnerId: string): boolean {
  return actorId === resourceOwnerId;
}
