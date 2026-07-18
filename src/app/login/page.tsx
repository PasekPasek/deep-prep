import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { signIn } from '@/auth';

export const dynamic = 'force-dynamic';

/**
 * The only public page.
 *
 * An access-denied state is shown for any OAuth error rather than distinguishing
 * "wrong account" from "provider failure" — telling a stranger which of the two
 * happened confirms whether an address is the allowlisted one.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm py-16">
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">DeepPrep</h1>
          <p className="text-sm text-muted-foreground">
            Private single-user app. Sign in with the account it belongs to.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Access denied. This account is not permitted to use this application.
            </p>
          )}

          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/' });
            }}
          >
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
