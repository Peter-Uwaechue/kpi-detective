# Deploying Willers Solutions on Vercel

This repository is prepared for Vercel's server-rendered public-site workflow. The `vercel.json` file installs dependencies with PNPM, builds the browser assets in `dist/public`, packages the SSR renderer in `dist/server-ssr`, and rewrites public requests to the `api/ssr.js` function. Every approved public route therefore returns crawlable HTML and route-specific metadata on a direct request, then hydrates into the existing React experience.

## Connect the repository

1. Sign in to [Vercel](https://vercel.com/) and select **Add New → Project**.
2. Import the private `Peter-Uwaechue/Willers-solutions` repository.
3. Keep the detected build settings from `vercel.json`, select the `main` branch for production, and deploy.
4. In Vercel's project settings, enable automatic production deployments for pushes to `main` and preview deployments for pull requests.

## SEO environment settings

Set the following **Production** environment variables in Vercel Project Settings before promoting a custom production domain. These values are not credentials and must match the public site identity:

| Variable | Recommended value |
|---|---|
| `CANONICAL_ORIGIN` | `https://willers-solution-beta.vercel.app` until the final Willers domain is connected; then use that final `https://` origin without a trailing slash. |
| `SITE_NAME` | `Willers Solutions Limited` |

`CANONICAL_ORIGIN` controls canonical URLs and the `og:url` tag, while `SITE_NAME` controls the Open Graph site name and metadata fallback. The renderer includes safe defaults, but the project settings should be updated as soon as the final public domain is selected.

## Important integration note

The public corporate website now uses a Vercel-compatible SSR function for page rendering. Its approved visual assets load from stable absolute published URLs, so they work from Vercel instead of resolving incorrectly as Vercel-relative `/manus-storage` paths. The repository also contains authentication and database scaffolding that relies on Manus-provided services during local Manus hosting. Do not copy Manus credentials into Vercel. If server-side integrations are activated later, configure only the equivalent credentials that you control in Vercel Project Settings.

## Updating the Vercel site

Each push to `main` will cause Vercel to build and deploy the latest code automatically. For changes made in Manus, export or push the updated code to this repository, then Vercel will receive the update from GitHub.

### Commit-author requirement for the private repository

Vercel associates GitHub-triggered deployments with the **commit author**. Because this is a private repository, each commit that should deploy must be authored with the verified GitHub email belonging to the connected Vercel team member: `Peter Uwaechue <uwaechuepeter2@gmail.com>`. Do not use a generic automation address such as `noreply@willerssolutions.com` for commits to `main`; Vercel will block that deployment unless that identity is an eligible team member.

The dedicated GitHub working copy is configured with this identity. If the repository is cloned again or commits are created elsewhere, configure it before committing:

```bash
git config user.name "Peter Uwaechue"
git config user.email "uwaechuepeter2@gmail.com"
```

The GitHub account must remain connected in Vercel **Authentication Settings**. The commit does not need GitHub’s signed-commit verification badge; Vercel accepts it when its author resolves to the connected team member.
