import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { ImageUploadNodeView } from "./image-upload-node-view";

export interface ImageUploadNodeOptions {
  /** Acceptable file types, as for `<input accept>`. */
  accept: string;
  /** Maximum file size in bytes. */
  maxSize: number;
  /** Uploads the file and resolves to its public URL. */
  upload: (file: File) => Promise<string>;
  onError?: (error: Error) => void;
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    imageUpload: {
      /** Inserts the "click or drop an image here" block at the cursor. */
      setImageUploadNode: () => ReturnType;
    };
  }
}

/**
 * A block that asks for an image and swaps itself for the real `image` node
 * once the upload finishes. Ported from the fluency-lab-plataform editor
 * (tiptap-node/image-upload-node), minus its SCSS and tiptap-ui primitives.
 *
 * It is only ever a transient placeholder: `parseHTML` returns nothing, so one
 * left behind in a saved note (serialised as an empty `<div>`) is dropped on the
 * next load instead of coming back as a dead upload box.
 */
export const ImageUploadNode = Node.create<ImageUploadNodeOptions>({
  name: "imageUpload",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      accept: "image/*",
      maxSize: 0,
      upload: async () => {
        throw new Error("Upload function is not defined");
      },
      onError: undefined,
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "image-upload" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadNodeView);
  },

  addCommands() {
    return {
      setImageUploadNode:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
