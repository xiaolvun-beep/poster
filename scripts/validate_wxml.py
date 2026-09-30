from html.parser import HTMLParser
from pathlib import Path


class WxmlParser(HTMLParser):
    def __init__(self, file):
        super().__init__(convert_charrefs=False)
        self.file = file
        self.stack = []

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise ValueError(f'{self.file}: unexpected </{tag}>')


root = Path(__file__).resolve().parents[1]
files = list((root / 'pages').rglob('*.wxml')) + list((root / 'components').rglob('*.wxml'))
for file in files:
    parser = WxmlParser(file)
    parser.feed(file.read_text(encoding='utf-8'))
    parser.close()
    if parser.stack:
        raise ValueError(f'{file}: unclosed tags {parser.stack}')
print(f'{len(files)} WXML files balanced')
