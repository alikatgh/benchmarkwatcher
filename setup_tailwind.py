import re

html_path = 'app/templates/base.html'
css_path = 'app/static/css/input.css'
js_path = 'tailwind.config.js'

with open(html_path, 'r') as f:
    content = f.read()

# Extract styles
style_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
css_content = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n" + (style_match.group(1) if style_match else "")

with open(css_path, 'w') as f:
    f.write(css_content)

# Extract config
config_match = re.search(r'tailwind\.config\s*=\s*({.*?});', content, re.DOTALL)
config_obj = config_match.group(1) if config_match else "{}"

tailwind_config_content = f"""/** @type {{import('tailwindcss').Config}} */
module.exports = {{
  content: [
    "./app/templates/**/*.html",
    "./app/static/js/**/*.js"
  ],
  darkMode: 'class',
  theme: {config_obj[:-1] if config_obj.endswith('}') else config_obj}}}
}};
"""

with open(js_path, 'w') as f:
    f.write(tailwind_config_content)

# Remove the script/style block from base.html and inject standard styles
new_content = re.sub(
    r'<script src="https://cdn\.tailwindcss\.com"></script>.*?<script src="{{ url_for\(\'static\', filename=\'js/base\.js\'\) }}"></script>',
    '<link rel="stylesheet" href="{{ url_for(\'static\', filename=\'css/tailwind.css\') }}">\n    <script src="{{ url_for(\'static\', filename=\'js/base.js\') }}"></script>',
    content,
    flags=re.DOTALL
)

with open(html_path, 'w') as f:
    f.write(new_content)

print("Tailwind setup generated.")
