// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, retry } from 'rxjs/operators';
const Fuse = require('fuse.js');

import { checkTagsFileExists, loadTags, generateTags, displayCtagsCommand } from './ctags';
import { canActivatePlugin, getConfig, getTagFilePath } from './helper';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// check the tag file exists. If not propose to generate it. If exists we populate the cache.
	checkTagsFileExists();

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('ctags.searchTags', () => {
		// The code you place here will be executed every time your command is executed

		if (! getTagFilePath()) {
			vscode.window.showErrorMessage('ctags.tagPath can not be empty');
			return;
		}

		if (! canActivatePlugin()) {
			vscode.window.showInformationMessage('ctags can not be activated, you should be in a folder or workspace.');
			return;
		}
		searchTags();
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}


async function searchTags() {
	// TODO: we should be sure the tags are loaded, it can be in progress
	const tags: Array<{}> = loadTags();
	const item: any = await searchTagsQuickPick(tags);
	if (! item) {
		return;
	}
	vscode.workspace.openTextDocument(item.filePath)
		.then(document => vscode.window.showTextDocument(document))
		.then(() => {
			if (vscode.window.activeTextEditor) {
				let line = item.lineNumber;
				if (line > 0) {
					line -= 1;
				}
				let newSelection = new vscode.Selection(line, 0, line, 0);
				vscode.window.activeTextEditor.selection = newSelection;
				vscode.window.activeTextEditor.revealRange(newSelection, vscode.TextEditorRevealType.InCenter);
			}
		});
}


async function searchTagsQuickPick(tags: Array<{}>) {
	const options = {
		includeScore: true,
		keys: ['match']
	};
	const fuse = new Fuse(tags, options);
	let input: vscode.QuickPick<any>;
	const disposables: vscode.Disposable[] = [];
	const subject = new Subject();
	const conf = vscode.workspace.getConfiguration('ctags');
	const debounce = getConfig('debounceTime') as number;
	const maxNumberOfMatches = getConfig('maxNumberOfMatches') as number;

	const settingsItems = [
		{
			label: 'Generate tags',
			alwaysShow: true,
			action: generateTags,
		},
		{
			label: 'Display ctags command',
			alwaysShow: true,
			action: displayCtagsCommand,
		},
	];

	const sub: Subscription = subject.pipe(
		debounceTime(debounce),
		distinctUntilChanged(),
	).subscribe((value) => {
		input.busy = true;
		if (!value) {
			input.items = [];
		} else {
		const result = fuse.search(value);
		input.items = result.map((r: any) => r.item).slice(0, maxNumberOfMatches);
		}
		input.busy = false;
	});
	try {
		return await new Promise<{} | undefined>((resolve, reject) => {
			input = vscode.window.createQuickPick();
			// There is a typescript issue, using sortByLabel works but it's not defined in the type
			(input as any).sortByLabel = false;
			input.placeholder = 'Type to search for tags';
			disposables.push(
				input.onDidChangeValue(value => {
					if (value.startsWith('>')) {
						input.items = settingsItems;
					} else {
						subject.next(value);
					}
				}),
				input.onDidChangeSelection(items => {
					const item  = items[0];
					if (item.action) {
						item.action();
					} else {
						resolve(item);
					}
					input.hide();
				}),
				input.onDidHide(() => {
					resolve(undefined);
					input.dispose();
				})
			);
			input.show();
		});
	} finally {
		disposables.forEach(d => d.dispose());
		sub.unsubscribe();
	}
}