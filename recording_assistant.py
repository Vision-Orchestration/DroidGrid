import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
if __name__ == "__main__":
    from recording.recording_assistant import main
    main()
