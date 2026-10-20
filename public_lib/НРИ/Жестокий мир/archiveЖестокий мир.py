import os
import re

# Путь к директории, содержащей .md файлы
root_dir = r"D:\Github\MainObsidian\2. НРИ\1.2. Играю\Жестокий мир\Игры"
output_file = "собранный_сеттинг.md"

# Функция для натуральной сортировки
def natural_key(string):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', string)]

def read_file_with_fallback(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        try:
            with open(path, "r", encoding="windows-1251") as f:
                return f.read()
        except Exception as e:
            print(f"Не удалось прочитать файл: {path} — {e}")
            return None

with open(output_file, "w", encoding="utf-8") as outfile:
    # Справка
    outfile.write("**Справка**\n\n")
    outfile.write("Этот документ представляет собой объединённый файл, собранный из всех Markdown-файлов (.md) внутри директории `content` и её поддиректорий.\n")
    outfile.write("Каждый файл отмечен заголовком вида: `файл *относительный_путь_файла*`\n\n")
    outfile.write("---\n\n")

    for foldername, subfolders, filenames in os.walk(root_dir):
        subfolders.sort(key=natural_key)
        filenames.sort(key=natural_key)
        for filename in filenames:
            if filename.lower().endswith(".md"):
                file_path = os.path.join(foldername, filename)
                relative_path = os.path.relpath(file_path, root_dir)
                content = read_file_with_fallback(file_path)
                if content is not None:
                    outfile.write(f"файл *{relative_path}*\n\n")
                    outfile.write(content + "\n\n")
print('готово')
