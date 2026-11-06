export class AccountDeletionError extends Error {
  constructor(stage, cause) {
    super(`Account deletion stopped at ${stage}`, {cause});
    this.stage = stage;
  }
}

// Same ordering as Flutter: authenticated D1 deletion, then Firebase Auth.
// Retries repeat idempotent DELETE /account; never call /sync or recreate a user.
export async function deleteActiloAccount({user, confirmed, removeCloud, removeIdentity, onCloudRemoved = () => {}}) {
  if (!confirmed) throw new AccountDeletionError('confirmation');
  if (!user?.uid) throw new AccountDeletionError('sign-in');
  try {
    const token = await user.getIdToken(true);
    await removeCloud(token);
  } catch (error) {
    throw new AccountDeletionError('cloud', error);
  }
  // A blocked sessionStorage must not prevent the second deletion step.
  try { onCloudRemoved(user.uid); } catch { /* Optional progress marker only. */ }
  try {
    await removeIdentity(user);
  } catch (error) {
    throw new AccountDeletionError('identity', error);
  }
  return {deleted: true};
}
