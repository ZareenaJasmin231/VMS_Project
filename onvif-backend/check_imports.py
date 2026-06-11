import ast
import builtins
import sys

filepath = r'c:\Users\miradorwin\Documents\GitHub\VMS_Project\onvif-backend\app\api\routers\camera_router.py'

with open(filepath, 'r', encoding='utf-8') as f:
    source = f.read()

tree = ast.parse(source)

imported_names = set()
defined_names = set()
used_names = set()

for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for alias in node.names:
            imported_names.add(alias.name.split('.')[0])
            if alias.asname:
                imported_names.add(alias.asname)
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            imported_names.add(alias.name)
            if alias.asname:
                imported_names.add(alias.asname)
    elif isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
        defined_names.add(node.name)
        for arg in node.args.args:
            defined_names.add(arg.arg)
    elif isinstance(node, ast.ClassDef):
        defined_names.add(node.name)
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                defined_names.add(target.id)
    elif isinstance(node, ast.Name):
        used_names.add(node.id)

builtin_names = set(dir(builtins))

missing = used_names - imported_names - defined_names - builtin_names
print("Potential missing names:")
for name in missing:
    print(name)
