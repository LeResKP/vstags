// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Observable, Subject, Subscription } from 'rxjs';
import { concatMap, debounceTime, distinctUntilChanged, first, map, retry, tap } from 'rxjs/operators';
const Fuse = require('fuse.js');

import { checkTagsFileExists, tagsSubject, tagsWatcher, generateTags, displayCtagsCommand, addCommandInGitHook } from './ctags';
import { canActivatePlugin, getConfig, getTagFilePath } from './helper';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// check the tag file exists. If not propose to generate it. If exists we populate the cache.
	checkTagsFileExists();

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposableSearchTags = vscode.commands.registerCommand('ctags.searchTags', () => {
		// The code you place here will be executed every time your command is executed
		doSearch(null);
	});

	let disposableSearchTextTags = vscode.commands.registerCommand('ctags.searchTextTags', () => {
		// The code you place here will be executed every time your command is executed
		const editor = vscode.window.activeTextEditor;
		let text = null;
		if (editor) {
			let selection = editor.selection;
			text = editor.document.getText(selection).trim();
			if (!text)  {
				let range = editor.document.getWordRangeAtPosition(selection.active);
				text = editor.document.getText(range);
			}
		}
		doSearch(text);
	});

	context.subscriptions.push(disposableSearchTags);
	context.subscriptions.push(disposableSearchTextTags);
}

// this method is called when your extension is deactivated
export function deactivate() {
	if (tagsWatcher) {
		// TODO: we should also dispose tagsWatcher.onDidChange
		tagsWatcher.dispose();
	}
}

function doSearch(text: string|null) {
	if (! getTagFilePath()) {
		vscode.window.showErrorMessage('ctags.tagPath can not be empty');
		return;
	}

	if (! canActivatePlugin()) {
		vscode.window.showInformationMessage('ctags can not be activated, you should be in a folder or workspace.');
		return;
	}
	searchTags(text);
}


function searchTags(text: string | null) {
	searchTagsQuickPick(text).subscribe((item: any) => {
		if (!item) {
			return;
		}
		vscode.workspace.openTextDocument(item.filePath)
			.then(document => {
				let line = item.lineNumber;
				if (line > 0) {
					line -= 1;
				}
				let newSelection = new vscode.Selection(line, 0, line, 0);
				return vscode.window.showTextDocument(document, { preview: false, selection: newSelection });
			});
	});
}

function fuseSearch() {
	const options = {
		includeScore: true,
		keys: ['match']
	};
	return tagsSubject.pipe(
		first(),
		map((tags: any) => new Fuse(tags, options))
	);
}


function exactMatchSearch() {
	// Same interface than fuseSearch
	return tagsSubject.pipe(
		first(),
		map((tags: any) => {
			return {
				search: (query: string) => {
					return tags.filter((tag: any) => {
						return tag.match === query;
					}).map((tag: any) => ({ item: tag }));
				}
			};
		})
	);
}

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
	{
		label: 'Add/update ctags command in git hook',
		alwaysShow: true,
		action: addCommandInGitHook,
	},
];


function searchTagsQuickPick(text: string|null) {
	let sub: Subscription;
	let input: vscode.QuickPick<any>;
	const disposables: vscode.Disposable[] = [];
	return new Observable(observer => {
		let inputItems: Array<any> = [];
		let found = false;
		if (text) {
			exactMatchSearch().subscribe((obj: any) => {
				const results = obj.search(text);
				if (results.length === 0) {
					vscode.window.showInformationMessage(`Nothing found for ${text}`);
				}
				else if (results.length === 1) {
					found = true;
					observer.next(results[0].item);
					observer.complete();
				} else {
					inputItems = results.map((r: any) => r.item);
				}
			});
		}

		if (found) {
			return;
		}

		const searcher = fuseSearch();
		input = vscode.window.createQuickPick();
		const debounce = getConfig('debounceTime') as number;
		const maxNumberOfMatches = getConfig('maxNumberOfMatches') as number;

		const subject = new Subject();
		sub = subject.pipe(
			debounceTime(debounce),
			distinctUntilChanged(),
		).subscribe((value) => {
			input.busy = true;
			if (!value) {
				input.items = [];
				input.busy = false;
			} else {
				searcher.subscribe((obj: any) => {
					const results = obj.search(value);
					input.items = results.map((r: any) => r.item).slice(0, maxNumberOfMatches);
					input.busy = false;
				});
			}
		});
		if (text) {
			input.value = text;
		}
		if (inputItems.length) {
			input.items = inputItems;
		}
		// There is a typescript issue, using sortByLabel works but it's not defined in the type
		(input as any).sortByLabel = false;
		input.placeholder = 'Type to search for tags';
		let isCompleted = false;
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
					isCompleted = true;
					observer.next(item);
					observer.complete();
				}
				input.hide();
			}),
			input.onDidHide(() => {
				if (!isCompleted) {
					observer.next(null);
					observer.complete();
				}
			})
		);
		input.show();
	}).pipe(
		tap(() => {
			if (input) {
				input.dispose();
			}
			disposables.forEach(d => d.dispose());
			if (sub) {
				sub.unsubscribe();
			}
		})
	);
}