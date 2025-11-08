import subprocess
import sys
import os

def run_script(script_path, project_root):
    """Run a Python script and return its exit code."""
    try:
        # Run from the project root so relative paths in helper scripts work correctly
        result = subprocess.run([sys.executable, script_path], check=True, cwd=project_root)
        print(f"Successfully ran {os.path.basename(script_path)}")
        return result.returncode
    except subprocess.CalledProcessError as e:
        print(f"Error running {os.path.basename(script_path)}: {e}")
        return e.returncode

if __name__ == "__main__":
    # Get the directory where this script is located (helper folder)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Get the project root (one level up from helper folder)
    project_root = os.path.dirname(script_dir)
    
    print(f"Running helper scripts from project root: {project_root}\n")
    
    # Run helper.py first
    helper_path = os.path.join(script_dir, "helper.py")
    run_script(helper_path, project_root)
    
    # Run helper2.py through helper6.py
    for i in range(2, 7):
        helper_path = os.path.join(script_dir, f"helper{i}.py")
        run_script(helper_path, project_root)