import * as vscode from 'vscode';
import * as cp from 'child_process';

import { ReplaySubject } from 'rxjs';
const fs = require('fs');
const lineByLine = require('n-readlines');
const path = require('path');

import { canActivatePlugin, getAbsoluteTagFilePath, getConfig, getTagFilePath } from './helper';

export const tagsSubject = new ReplaySubject(1);
export let tagsWatcher: vscode.FileSystemWatcher;


// TODO: ICONS should be defined according file extensions
// ctags --list-kinds
const ICONS: any = {
    c: '$(symbol-class)',
    m: '$(symbol-method)',
    f: '$(symbol-method)',
    v: '$(symbol-constant)',
    p: '$(symbol-parameter)',
};


export function loadTags(force = false) {
    const rootPath = vscode.workspace.rootPath as string;
    const tagPath = getTagFilePath() as string;
    tagsSubject.next(_loadTags(rootPath, tagPath));
}


function _loadTags(rootPath: string, tagPath: string){
    let tags=[];
    let liner = new lineByLine(path.join(rootPath, tagPath));
    let line;

    while (line = liner.next()) {
        const asciiLine = line.toString('ascii');
        if (asciiLine.startsWith('!_TAG_')) {
            continue;
        }
        let elements = asciiLine.split('\t');

        let name, absPath, lineNumber, kind, scope;
        if (elements.length === 4) {
            [name, absPath, lineNumber, kind] = elements;
        } else if (elements.length > 4) {
            [name, absPath, lineNumber, kind, scope] = elements;
        } else {
            console.error('ctags parse error', elements);
            continue;
        }
        lineNumber = parseInt(lineNumber.replace(';"', ''));

        let icon = ICONS[kind];
        if (icon) {
            icon += ' ';
        } else {
            icon = '';
            // console.error(`Unsupported icon type ${kind}`);
        }
        tags.push({
            description: scope,
            label: `${icon}${name}`,
            detail: path.relative(rootPath,absPath),
            filePath: absPath,
            lineNumber,
            alwaysShow: true,
            match: name,
        });

    }
    return tags;
}


export function getCtagsCommand() {
    const rootPath = vscode.workspace.rootPath as string;
    const tagPath = getAbsoluteTagFilePath() as string;
    const excludeFolders = getConfig('excludeFolders') as Array<string>;
    const params = excludeFolders.map((f) => `--exclude=${f}`).join(' ');
    const commandParams = getConfig('ctagsCommandParams') as Array<string>;
    const extraParams = commandParams.join(' ');
    return `ctags -R --excmd=number ${params} ${extraParams} -f ${tagPath} ${rootPath}`;
}


export function generateTags() {
    const tagPath = getTagFilePath() as string;
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
        title: "Generating tags",
        // TODO: add cancellable support. We should kill the process in case the command bad.
        // ie: there are some missing excludes so it takes a while
		cancellable: false
	}, (progress, token) => {
		return new Promise((resolve, reject) => {
			cp.exec(getCtagsCommand(), {cwd: vscode.workspace.rootPath}, (err, stdout) => {
				if (err) {
                    vscode.window.showErrorMessage(`Error during tag generation ${err}`);
					return reject(err);
				} else {
					resolve(stdout);
				}
			});
		});
    }).then(() => {
        if(!tagsWatcher) {
            loadTags();
            watchTagFile();
        }
    });
}


export function displayCtagsCommand() {
	vscode.window.showInformationMessage(getCtagsCommand(), ...['Generate tags']).then(res => {
		if (res === 'Generate tags') {
			generateTags();
		}
	});
}

export function watchTagFile() {
    if (tagsWatcher) {
        return;
    }
    const tagPath = getAbsoluteTagFilePath();
    if (fs.existsSync(tagPath)) {
        tagsWatcher = vscode.workspace.createFileSystemWatcher(tagPath);
        tagsWatcher.onDidChange(() => {
            loadTags(true);
            vscode.window.showInformationMessage('ctags reloaded!');
        });
    }
    return null;
}


export function checkTagsFileExists() {
    if (!canActivatePlugin()) {
        return;
    }

    watchTagFile();

    const tagPath = getAbsoluteTagFilePath();
    if (fs.existsSync(tagPath)) {
        // We want to be sure the tags are up to date when activating a workspace/folder
        generateTags();
        return;
    }
    // No tags file, ask the user if he wants to generate it.
	vscode.window.showInformationMessage('No tags file found', ...['View tags command', 'Generate tags']).then(res => {
		if (res === 'View tags command') {
			displayCtagsCommand();
		} else if (res === 'Generate tags') {
			generateTags();
		}
	});
}


export function addCommandInGitHook() {
    const rootPath = vscode.workspace.rootPath as string;
    const gitPath = path.join(rootPath, '.git');
    if (!fs.existsSync(gitPath)) {
        vscode.window.showErrorMessage(`No .git folder in ${rootPath}`);
        return;
    }
    addHookFile(path.join(gitPath, 'hooks/post-merge'));
    addHookFile(path.join(gitPath, 'hooks/post-checkout'));
}

function addHookFile(hookPath: string) {
    const promise = new Promise((resolve, reject) => {
        if (fs.existsSync(hookPath)) {
            resolve();
            return;
        }
        fs.writeFile(hookPath, `#!/usr/bin/sh\n`, (error: any) => {
            if (error) {
                reject(error);
                return;
            }
            fs.chmod(hookPath, '775', (error: any) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }).then(() => {
        return updateHookFile(hookPath);
   }).then(() => {
        vscode.workspace.openTextDocument(hookPath)
            .then(document => vscode.window.showTextDocument(document, {preview: false}));
   }).catch((error) => {
       vscode.window.showErrorMessage(error.toString());
   });
}


function updateHookFile(hookPath: string) {
    const encoding = 'utf-8';
    const date = new Date().toISOString();
    const text = `# vscode ctags do not edit manually\n# ${date}\n${getCtagsCommand()}\n# end vscode ctags`;
    return new Promise((resolve, reject) => {
        let liner;
        try {
            liner = new lineByLine(hookPath);
        } catch (error) {
            reject(error);
            return;
        }
        let line;

        let cnt = 0;
        const lis = [];
        while (line = liner.next()) {
            const utf8Line = line.toString(encoding);
            let pushList = true;
            if (cnt !== 0) {
                cnt += 1;
            } else if (utf8Line.match('^# vscode ctags')) {
                cnt += 1;
                lis.push(text);
                pushList = false;
            }
            if (cnt === 0 || cnt > 4) {
                lis.push(utf8Line);
            }
        }
        if (cnt === 0) {
            lis.push(`\n${text}`);
        }
        fs.writeFile(hookPath, lis.join('\n'), encoding, (error: any) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}