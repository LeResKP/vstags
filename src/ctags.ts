const lineByLine = require('n-readlines');
const path = require('path');


const ICONS: any = {
    c: '$(symbol-class)',
    m: '$(symbol-method)',
    f: '$(symbol-method)',
    v: '$(symbol-constant)',
    p: '$(symbol-parameter)',
};

export function loadTags(rootPath: string, tagPath: string){
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
            console.error(`Unsupported icon type ${kind}`);
        }
        tags.push({
            description: scope,
            label: `${icon}${name}`,
            detail: relPath,
            filePath: path.join(rootPath, relPath),
            lineNumber,
            alwaysShow: true,
        });

    }
    return tags;
}