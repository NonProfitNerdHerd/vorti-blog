/** Legacy callers supply their previous fallback; opted-in accounts share one identity. */
export function userIdentity(user, legacy) {
    if (!user)
        return '';
    if (user.attributionPreference === 'username')
        return user.username || '';
    if (user.attributionPreference === 'email')
        return user.email || '';
    return legacy ?? user.displayName ?? user.email ?? '';
}
export function publicAuthorIdentity(user) {
    return userIdentity(user, user?.profilePublic ? user.displayName || '' : '');
}
