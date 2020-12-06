import * as vscode from 'vscode';

const path = require('path');


export function getConfig(param:string) {
	const conf = vscode.workspace.getConfiguration('ctags');
    return conf.get(param);
}


export function getTagFilePath() {
    return getConfig('tagPath');
}


export function getAbsoluteTagFilePath() {
    return path.join(vscode.workspace.rootPath, getTagFilePath());
}


export function canActivatePlugin() {
    if (!vscode.workspace.rootPath) {
        // folder or workspace are not opened
        return false;
    }

    if (!getTagFilePath()) {
        // tag file empty in the conf
        return false;
    }
    return true;
}