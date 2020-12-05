// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
const Fuse = require('fuse.js');

import { loadTags } from './ctags';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ctags" is now active!');
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('ctags.searchTags', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Loading tags!');

		const rootPath = vscode.workspace.rootPath || '';
		if (! rootPath) {
			// TODO: add message
			vscode.window.showInformationMessage('No rootPath');
			return;
		}
		const tagPath = vscode.workspace.getConfiguration('ctags').get('tagPath') as string;
		const tags = loadTags(rootPath, tagPath);
		vscode.window.showInformationMessage('Tags loaded');
		searchTags(tags);
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}


async function searchTags(tags: Array<{}>) {
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
	const conf = vscode.workspace.getConfiguration('ctags')
	const debounce = conf.get('debounceTime') as number;
	const maxNumberOfMatches = conf.get('maxNumberOfMatches') as number;

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
			input.sortByLabel = false;
			input.placeholder = 'Type to search for tags';
			disposables.push(
				input.onDidChangeValue(value => {
					subject.next(value);
				}),
				input.onDidChangeSelection(items => {
					resolve(items[0]);
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