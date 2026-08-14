# Deploying Willers Solutions on Vercel

This repository is prepared for Vercel's Vite static-site deployment workflow. The `vercel.json` file installs dependencies with PNPM, builds the site, serves `dist/public`, and rewrites routes to `index.html` so that all Wouter routes work when opened directly.

## Connect the repository

1. Sign in to [Vercel](https://vercel.com/) and select **Add New → Project**.
2. Import the private `Peter-Uwaechue/Willers-solutions` repository.
3. Keep the detected build settings from `vercel.json`, select the `main` branch for production, and deploy.
4. In Vercel's project settings, enable automatic production deployments for pushes to `main` and preview deployments for pull requests.

## Important integration note

The public corporate website is configured to deploy as a Vite single-page application. Its approved visual assets load from stable absolute published URLs, so they work from Vercel instead of resolving incorrectly as Vercel-relative `/manus-storage` paths. The repository also contains server, authentication, and database scaffolding that relies on Manus-provided services during local Manus hosting. Do not copy Manus credentials into Vercel. If you later activate server-side integrations on the public site, add Vercel-compatible serverless functions and configure only the equivalent credentials that you control in Vercel Project Settings.

## Updating the Vercel site

Each push to `main` will cause Vercel to build and deploy the latest code automatically. For changes made in Manus, export or push the updated code to this repository, then Vercel will receive the update from GitHub.
