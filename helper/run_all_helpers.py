import subprocess
import sys
import os


def run_script(script_path, project_root):
    """Run a Python script and return its exit code."""
    try:
        # Run from the project root so relative paths in helper scripts work correctly
        result = subprocess.run(
            [sys.executable, script_path], check=True, cwd=project_root)
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

    # List of new helper script filenames in order
    helper_scripts = [
        "extract_parties_states_wahlkreis.py",
        "merge_candidate_state_wahlkreis.py",
        "generate_party_list.py",
        "replace_wahlkreis_names_with_numbers.py",
        "extract_state_party_combinations.py",
        "update_state_party_votes.py",
        "add_candidate_first_votes.py"
    ]

    # Run each helper script
    for script_name in helper_scripts:
        helper_path = os.path.join(script_dir, script_name)
        if not os.path.exists(helper_path):
            print(f"Script not found: {script_name}")
            continue
        run_script(helper_path, project_root)
