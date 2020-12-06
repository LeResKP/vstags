import * as vscode from 'vscode';
import * as cp from 'child_process';

const fs = require('fs');
const lineByLine = require('n-readlines');
const path = require('path');

import { canActivatePlugin, getAbsoluteTagFilePath, getConfig, getTagFilePath } from './helper';



// TODO: ICONS should be defined according file extensions
// ctags --list-kinds
const ICONS: any = {
    c: '$(symbol-class)',
    m: '$(symbol-method)',
    f: '$(symbol-method)',
    v: '$(symbol-constant)',
    p: '$(symbol-parameter)',
};


const TAGS_CACHES: any = {};


export function loadTags(force = false) {
    const rootPath = vscode.workspace.rootPath as string;
    const tagPath = getTagFilePath() as string;
	if (!TAGS_CACHES[rootPath] || force) {
		TAGS_CACHES[rootPath] = _loadTags(rootPath, tagPath);
	}
	return TAGS_CACHES[rootPath];
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

        let name, relPath, lineNumber, kind, scope;
        if (elements.length === 4) {
            [name, relPath, lineNumber, kind] = elements;
        } else if (elements.length > 4) {
            [name, relPath, lineNumber, kind, scope] = elements;
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
            detail: relPath,
            filePath: path.join(rootPath, relPath),
            lineNumber,
            alwaysShow: true,
            match: name,
        });

    }
    return tags;
}


export function getCtagsCommand() {
    const tagPath = getTagFilePath() as string;
    const excludeFolders = getConfig('excludeFolders') as Array<string>;
	const params = (excludeFolders).map((f) => `--exclude=${f}`).join(' ');
	return `ctags -R --excmd=number ${params} -f ${tagPath}`;
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
                    progress.report({ increment: 50, message: "Loading tags" });
                    loadTags(true);
                    vscode.window.showInformationMessage('ctags generated');
					resolve(stdout);
				}
			});
		});
    });
}


export function displayCtagsCommand() {
	vscode.window.showInformationMessage(getCtagsCommand(), ...['Generate tags']).then(res => {
		if (res === 'Generate tags') {
			generateTags();
		}
	});
}


export function checkTagsFileExists() {
    if (!canActivatePlugin()) {
        return;
    }
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