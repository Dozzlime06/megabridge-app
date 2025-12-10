import { getUncachableGitHubClient } from '../server/github';
import * as fs from 'fs';
import * as path from 'path';

const REPO_NAME = 'megabridge-app';
const REPO_DESCRIPTION = 'MegaETH Bridge - Bridge ETH between Base and MegaETH';

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.replit',
  'replit.nix',
  '.config',
  '.cache',
  'dist',
  '.upm',
  'generated-icon.png',
  '.breakpoints',
  '/tmp/',
  'package-lock.json',
  '.local',
];

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (shouldIgnore(fullPath)) return;
    
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

async function main() {
  console.log('Getting GitHub client...');
  const octokit = await getUncachableGitHubClient();
  
  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);

  let repo;
  try {
    const { data: existingRepo } = await octokit.repos.get({
      owner: user.login,
      repo: REPO_NAME,
    });
    repo = existingRepo;
    console.log(`Repository ${REPO_NAME} already exists: ${repo.html_url}`);
  } catch (error: any) {
    if (error.status === 404) {
      console.log(`Creating repository ${REPO_NAME}...`);
      const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
        name: REPO_NAME,
        description: REPO_DESCRIPTION,
        private: false,
        auto_init: true,
      });
      repo = newRepo;
      console.log(`Created repository: ${repo.html_url}`);
      console.log('Waiting for repository to initialize...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      throw error;
    }
  }

  // Check if repo is empty and initialize with README if needed
  try {
    await octokit.repos.getContent({
      owner: user.login,
      repo: REPO_NAME,
      path: 'README.md',
    });
    console.log('Repository has content, proceeding...');
  } catch (error: any) {
    if (error.status === 404) {
      console.log('Repository is empty, creating initial README...');
      await octokit.repos.createOrUpdateFileContents({
        owner: user.login,
        repo: REPO_NAME,
        path: 'README.md',
        message: 'Initial commit',
        content: Buffer.from('# MegaBridge\n\nBridge ETH between Base and MegaETH').toString('base64'),
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('Collecting files...');
  const files = getAllFiles('.');
  console.log(`Found ${files.length} files to upload`);

  let tree: any[] = [];
  
  for (const filePath of files) {
    const relativePath = filePath.startsWith('./') ? filePath.slice(2) : filePath;
    const content = fs.readFileSync(filePath);
    
    const isBinary = relativePath.endsWith('.png') || relativePath.endsWith('.jpg') || 
                     relativePath.endsWith('.ico') || relativePath.endsWith('.woff') ||
                     relativePath.endsWith('.woff2') || relativePath.endsWith('.ttf');
    
    try {
      if (isBinary) {
        const { data: blob } = await octokit.git.createBlob({
          owner: user.login,
          repo: REPO_NAME,
          content: content.toString('base64'),
          encoding: 'base64',
        });
        tree.push({
          path: relativePath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        });
      } else {
        const { data: blob } = await octokit.git.createBlob({
          owner: user.login,
          repo: REPO_NAME,
          content: content.toString('utf-8'),
          encoding: 'utf-8',
        });
        tree.push({
          path: relativePath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        });
      }
      console.log(`Uploaded: ${relativePath}`);
    } catch (err: any) {
      console.error(`Failed to upload ${relativePath}: ${err.message}`);
    }
  }

  console.log('Creating tree...');
  const { data: newTree } = await octokit.git.createTree({
    owner: user.login,
    repo: REPO_NAME,
    tree,
  });

  let parentSha: string[] = [];
  try {
    const { data: ref } = await octokit.git.getRef({
      owner: user.login,
      repo: REPO_NAME,
      ref: 'heads/main',
    });
    parentSha = [ref.object.sha];
  } catch {
    // No existing commits
  }

  console.log('Creating commit...');
  const { data: commit } = await octokit.git.createCommit({
    owner: user.login,
    repo: REPO_NAME,
    message: 'MegaBridge - Full codebase',
    tree: newTree.sha,
    parents: parentSha,
  });

  console.log('Updating main branch...');
  try {
    await octokit.git.updateRef({
      owner: user.login,
      repo: REPO_NAME,
      ref: 'heads/main',
      sha: commit.sha,
      force: true,
    });
  } catch {
    await octokit.git.createRef({
      owner: user.login,
      repo: REPO_NAME,
      ref: 'refs/heads/main',
      sha: commit.sha,
    });
  }

  console.log('\n✅ Successfully pushed to GitHub!');
  console.log(`📦 Repository: https://github.com/${user.login}/${REPO_NAME}`);
  console.log('\nYou can now import this repository in Vercel:');
  console.log(`https://vercel.com/import/git?s=${encodeURIComponent(`https://github.com/${user.login}/${REPO_NAME}`)}`);
}

main().catch(console.error);
