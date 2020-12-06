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
		const editor = vscode.window.activeTextEditor;
		let text = null;
		if (editor) {
			let selection = editor.selection;
			text = editor.document.getText(selection).trim();
		}
		searchTags(text);
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}


async function searchTags(text: string|null) {
	// TODO: we should be sure the tags are loaded, it can be in progress
	const tags: Array<{}> = loadTags();
	const item: any = await searchTagsQuickPick(tags, text);
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

function fuseSearch(tags: Array<{}>) {
	const options = {
		includeScore: true,
		keys: ['match']
	};
	return new Fuse(tags, options);
}


function exactMatchSearch(tags: Array<{}>) {
	// Same interface than fuseSearch
	return {
		search: (query: string) => {
			return tags.filter((tag: any) => {
				return tag.match === query;
			}).map((tag) => ({ item: tag }));
		}
	};
}


async function searchTagsQuickPick(tags: Array<{}>, text: string|null) {
	let searcher: any;
	let exactMatch;
	let inputItems: Array<any>;
	if (text) {
		searcher = exactMatchSearch(tags);
		exactMatch = true;
		const results = searcher.search(text);
		if (results.length === 0) {
			vscode.window.showInformationMessage(`Nothing found for ${text}`);
		}
		else if (results.length === 1) {
			return results[0].item;
		} else {
			inputItems = results.map((r: any) => r.item);
		}
	}

	searcher = fuseSearch(tags);

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
		const result = searcher.search(value);
		input.items = result.map((r: any) => r.item).slice(0, maxNumberOfMatches);
		}
		input.busy = false;
	});
	try {
		return await new Promise<{} | undefined>((resolve, reject) => {
			input = vscode.window.createQuickPick();
			if (text) {
				input.value = text;
			}
			if (inputItems) {
				input.items = inputItems;
			}
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